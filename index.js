// import { readFileSync } from "fs";

const request = require("request-promise-native");
const _ = require("lodash");
const fs = require("fs");
const cheerio = require("cheerio");

// const textToParse = fs.readFileSync("./text.txt").toString();
// Work some stemming magic here
const wordsToTag = [/*"уиски"/*, "четиво", "тест", "програма"*/];

function postToBulnetPromise(body, apiPath = "search") {
    const options = {
        method: "POST",
        uri: `http://dcl.bas.bg/bulnet/api/${apiPath}`,
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        body,
        proxy: "http://localhost:8888", // Fiddler debugging
        json: true
    };

    return request.post(options);
}

function getNyms(responses, mapLambda = r => r.hyponym) {
    const allHtmlText = _(responses)
        .map(mapLambda)
        .filter(Boolean)
        .flatten()
        .reduce((out, elem) => out += elem.html, "");

    const re = /<span class="h-word">(.*?)<\/span>/g;
    const nyms = [];
    let match = null;
    do {
        match = re.exec(allHtmlText);
        if (match) {
            nyms.push(match[1]);
        }
    } while (match);

    return nyms;
}

function getNymsObject(word) {
    console.log("getNymsObject", word);
    const searchBody = {
        query: word,
        exact: true,
        type: "Synset",
        "page": 1
    };


    return postToBulnetPromise(searchBody)
        .then(response => {
            const { results } = response;
            const isNoun = r => r.pos === "n";
            const shouldGetNeighbours = _.some(results, isNoun);
            if (shouldGetNeighbours) {
                const allNounsIds = _(results).filter(isNoun).map(r => r.id).value();
                return Promise.all(_.map(allNounsIds,
                    id => {
                        const neighboursBody = {
                            id,
                            verified: true
                        };
                        return postToBulnetPromise(neighboursBody, "neighbours");
                    }));
            }
        })
        .then(responses => {
            if (responses) {
                const hyponyms = getNyms(responses);
                // const hypernyms = getNyms(responses, r => r.hypernym);
                return { hyponyms/*, hypernyms*/ };
            }
        })
        .catch(err => {
            console.error("An error occurred", err);
        });
}

const text = "даже да умирам няма да ти звънна";
const options = {
    method: "GET",
    uri: `http://semantic.netpeak.bg/`,
    resolveWithFullResponse: true
    // proxy: "http://localhost:8888", // Fiddler debugging
};

let cookie = null;
const dictWordNyms = {};
return request(options)
    .then(res => {
        cookie = _.head(res.headers["set-cookie"]);
        const body = res.body;
        const re = /<input.*name="(.*?)".*class="form-hash".*value="(.*?)".*?>/;
        const match = re.exec(body);
        if (!match) {
            throw new Error("Cannot collect form hash");
        }

        const formHashKey = match[1];
        const formHashValue = match[2];
        // TODO: get this from file
        const textValue = "%D0%B1%D0%B0%D1%89%D0%B0%D1%82%D0%B0+%D0%B8+%D0%BC%D1%8A%D0%B6";
        const postOptions = {
            method: "POST",
            uri: `http://semantic.netpeak.bg/`,
            body: `text=${textValue}&submit=submit&${formHashKey}=${formHashValue}`,
            headers: {
                "Cookie": cookie,
                "Content-Type": "application/x-www-form-urlencoded"
            }
            // proxy: "http://localhost:8888", // Fiddler debugging
        };
        return request.post(postOptions);
    })
    .then(res => {
        const html = cheerio.load(res);
        const words = html('tbody')
            .eq(1)
            .children()
            .map((index, childJS) => cheerio(childJS).children().first().text());
        const dict = {};
        const promises = _.map(words, word => {
            return getNymsObject(word)
                .then(obj => {
                    dictWordNyms[word] = obj;
                    console.log("word", word)
                });
        });

        return Promise.all(promises);
    })
    .then(res => {
        console.log(dictWordNyms);
        const filteredDict = _.pickBy(dictWordNyms, _.identity);

    })
    .catch(e => {
        console.error(e);
    });