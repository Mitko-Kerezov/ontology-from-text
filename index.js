const request = require("request-promise-native");
const _ = require("lodash");
const fs = require("fs");

const textToParse = fs.readFileSync("./text.txt").toString();
// Work some stemming magic here
const wordsToTag = ["уиски"/*, "четиво", "тест", "програма"*/];

function postToBulnetPromise(body, apiPath = "search") {
    const options = {
        method: "POST",
        uri: `http://dcl.bas.bg/bulnet/api/${apiPath}`,
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        body,
        // proxy: "http://localhost:8888", // Fiddler debugging
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

wordsToTag.forEach(word => {
    const searchBody = {
        query: word,
        exact: true,
        type: "Synset",
        "page": 1
    };


    postToBulnetPromise(searchBody)
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
            const hyponyms = getNyms(responses);
            const hypernyms = getNyms(responses, r => r.hypernym);
            console.log(hyponyms, hypernyms);
        })
        .catch(err => {
            console.error("An error occurred", err);
        });
});