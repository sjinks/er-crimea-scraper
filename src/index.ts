import fs = require('fs');
import path = require('path');
import util = require('util');
import request = require('request');
import { DOMParserImpl as dom } from 'xmldom-ts';
import * as xpath from 'xpath-ts';
import cheerio = require('cheerio');
import csv = require('fast-csv');

const writeFile = util.promisify(fs.writeFile);

function parseSitemap(url: string): Promise<string[]> {
    return new Promise((resolve: (s: string[]) => void, reject: (e: Error) => void) => {
        request(url, function(error, response, body): void {
            if (error) {
                reject(error);
            } else if (response.statusCode !== 200) {
                reject(new Error(`HTTP error ${response.statusCode}`));
            } else {
                const doc = new dom().parseFromString(body);
                const select = xpath.useNamespaces({ sitemap: 'http://www.sitemaps.org/schemas/sitemap/0.9' });
                const nodes = select('/sitemap:urlset/sitemap:url/sitemap:loc/text()', doc) as Node[];

                const urls = nodes
                    .map((n: Node): string => n.nodeValue || '')
                    .filter((s: string): boolean => s.indexOf('/persona/') !== -1)
                ;

                resolve(urls);
            }
        });
    });
}

function sanitizeHtml(s: string): string {
    return s
        .replace(/<\/?(?:span|strong|em|a|div|table|tbody|t[rdh]|tfoot|iframe)[^>]*>/ig, '')
        .replace(/<script[^>]*>.*?<\/script>/isg, '')
        .replace(/<p[^>]*>\s*/ig, '')
        .replace(/<\/p>/ig, '\n\n')
        .replace(/<br\s*\/?>/ig, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    ;
}

function parsePerson(url: string): Promise<any> {
    return new Promise((resolve: (s: object) => void, reject: (e: Error) => void) => {
        request(url, function(error, response, body): void {
            if (error) {
                reject(error);
            } else if (response.statusCode !== 200) {
                reject(new Error(`HTTP error ${response.statusCode}`));
            } else {
                const $ = cheerio.load(body, { normalizeWhitespace: true, decodeEntities: false, recognizeSelfClosing: true });
                const img = $('.aboutPerson > img').attr('src') || '';
                const name = $('.aboutPerson > h1').text().trim().replace(/\s+/g, ' ');
                const descr = sanitizeHtml($('.aboutPerson > .descr').html() || '');
                const branch = $('title').text().split(' | ')[0].trim();
                const cats = $('#col_left div.breadcrumbs > span > a');
                const category = cats.length ? cats.last().text().trim() : '';
                resolve({ branch, img, name, descr, category, url, html: body });
            }
        });
    });
}

function downloadAndSave(url: string, to: string): Promise<void> {
    return new Promise((resolve: () => void, reject: (e: Error) => void) => {
        request(url)
            .on('response', (resp): void => {
                if (resp.statusCode === 200) {
                    resp
                        .on('end', (): void => {
                            resolve();
                        })
                        .pipe(fs.createWriteStream(to))
                    ;
                } else {
                    reject(new Error('Not found'));
                }
            })
            .on('error', (e: Error): void => {
                reject(e);
            })
        ;
    });
}

async function main(subdomain: string): Promise<void> {
    try {
        fs.mkdirSync(`./${subdomain}`, { mode: 0o755 });
    } catch (e) {
        if (e.code !== 'EEXIST') {
            throw e;
        }
    }

    const csvstream = csv.format();
    const out = fs.createWriteStream(`./${subdomain}/${subdomain}.csv`, { mode: 0o644 });
    csvstream.pipe(out);

    const urls = await parseSitemap(`http://${subdomain}.er-crimea.com/sitemap.xml`);

    for (const url of urls) {
        console.log(url);
        const u = new URL(url);
        const data = await parsePerson(url);
        if (data.name) {
            await writeFile(`./${subdomain}/${path.basename(u.pathname)}.html`, data.html);
            if (data.img) {
                const fullsize = data.img.replace(/(-\d+x\d+)(\.[a-z]+)$/, '$2');
                try {
                    await downloadAndSave(fullsize, `./${subdomain}/${path.basename(u.pathname)}${path.extname(fullsize)}`);
                    data.img = `${path.basename(u.pathname)}${path.extname(fullsize)}`;
                } catch (e) {
                    try {
                        await downloadAndSave(data.img, `./${subdomain}/${path.basename(u.pathname)}${path.extname(data.img)}`);
                        data.img = `${path.basename(u.pathname)}${path.extname(data.img)}`;
                    } catch (e) {
                        data.img = '';
                    }
                }
            }

            const row = [
                data.url,
                data.name,
                data.branch,
                data.category,
                data.descr,
                data.img
            ];

            csvstream.write(row);
        }
    }

    csvstream.end();
}

if (process.argv.length !== 3) {
    process.stderr.write('node index.js subdomain');
}

main(process.argv[2]);
