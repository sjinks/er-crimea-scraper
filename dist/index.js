"use strict";
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (Object.hasOwnProperty.call(mod, k)) result[k] = mod[k];
    result["default"] = mod;
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const path = require("path");
const util = require("util");
const request = require("request");
const xmldom_ts_1 = require("xmldom-ts");
const xpath = __importStar(require("xpath-ts"));
const cheerio = require("cheerio");
const csv = require("fast-csv");
const writeFile = util.promisify(fs.writeFile);
function parseSitemap(url) {
    return new Promise((resolve, reject) => {
        request(url, function (error, response, body) {
            if (error) {
                reject(error);
            }
            else if (response.statusCode !== 200) {
                reject(new Error(`HTTP error ${response.statusCode}`));
            }
            else {
                const doc = new xmldom_ts_1.DOMParserImpl().parseFromString(body);
                const select = xpath.useNamespaces({ sitemap: 'http://www.sitemaps.org/schemas/sitemap/0.9' });
                const nodes = select('/sitemap:urlset/sitemap:url/sitemap:loc/text()', doc);
                const urls = nodes
                    .map((n) => n.nodeValue || '')
                    .filter((s) => s.indexOf('/persona/') !== -1);
                resolve(urls);
            }
        });
    });
}
function sanitizeHtml(s) {
    return s
        .replace(/<\/?(?:span|strong|em|a|div|table|tbody|t[rdh]|tfoot|iframe)[^>]*>/ig, '')
        .replace(/<script[^>]*>.*?<\/script>/isg, '')
        .replace(/<p[^>]*>\s*/ig, '')
        .replace(/<\/p>/ig, '\n\n')
        .replace(/<br\s*\/?>/ig, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
function parsePerson(url) {
    return new Promise((resolve, reject) => {
        request(url, function (error, response, body) {
            if (error) {
                reject(error);
            }
            else if (response.statusCode !== 200) {
                reject(new Error(`HTTP error ${response.statusCode}`));
            }
            else {
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
function downloadAndSave(url, to) {
    return new Promise((resolve, reject) => {
        request(url)
            .on('response', (resp) => {
            if (resp.statusCode === 200) {
                resp
                    .on('end', () => {
                    resolve();
                })
                    .pipe(fs.createWriteStream(to));
            }
            else {
                reject(new Error('Not found'));
            }
        })
            .on('error', (e) => {
            reject(e);
        });
    });
}
async function main(subdomain) {
    try {
        fs.mkdirSync(`./${subdomain}`, { mode: 0o755 });
    }
    catch (e) {
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
                }
                catch (e) {
                    try {
                        await downloadAndSave(data.img, `./${subdomain}/${path.basename(u.pathname)}${path.extname(data.img)}`);
                        data.img = `${path.basename(u.pathname)}${path.extname(data.img)}`;
                    }
                    catch (e) {
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
//# sourceMappingURL=index.js.map