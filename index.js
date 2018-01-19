const request = require("request-promise-native");
const _ = require("lodash");
const fs = require("fs");

const textToParse = fs.readFileSync("./text.txt").toString();
// Work some stemming magic here
const wordsToTag = ["син"/*, "четиво", "тест", "програма"*/];
wordsToTag.forEach(word => {
    const options = {
        method: "POST",
        uri: "http://dcl.bas.bg/bulnet/api/search",
        headers: {
            'X-Requested-With': 'XMLHttpRequest'
        },
        body: {
            query: word,
            exact: true,
            type: "Synset",
            "page": 1
        },
        // proxy: "http://localhost:8888", // Fiddler debugging
        json: true
    };

    request
        .post(options)
        .then(response => {
            const candiatePos = _(response.results)
                .map(r => r.pos)
                .reduce((out, i) => {
                    out[i] = out[i] || 0;
                    ++out[i];
                    return out;
                }, {});
            console.log(candiatePos);
        })
        .catch(err => {
            console.error("An error occurred", err);
        });
});