const { readFileSync, writeFileSync } = require("fs");
const request = require("request-promise-native");
const _ = require("lodash");
const fs = require("fs");
const cheerio = require("cheerio");

const Thing = "Thing";
const TemplateFileName = "template.owl";
const ExampleTextFileName = "text.txt";
const StopwordsFileName = "stopwords.txt";

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

    const extractNymsRegex = /<span class="h-word">(.*?)<\/span>/g;
    const nyms = [];
    let match = null;
    do {
        match = extractNymsRegex.exec(allHtmlText);
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
            const isNounFilter = r => r.pos === "n";
            const shouldGetNeighbours = _.some(results, isNounFilter);
            if (shouldGetNeighbours) {
                const allNounsIds = _(results).filter(isNounFilter).map(r => r.id).value();
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
                // const hyponyms = getNyms(responses);
                const hypernyms = getNyms(responses, r => r.hypernym);
                return { /*hyponyms, */hypernyms };
            }
        })
        .catch(err => {
            console.error("An error occurred", err);
        });
}

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
        const extractHashRegex = /<input.*name="(.*?)".*class="form-hash".*value="(.*?)".*?>/;
        const match = extractHashRegex.exec(body);
        if (!match) {
            throw new Error("Cannot collect form hash");
        }

        const formHashKey = match[1];
        const formHashValue = match[2];
        const text = readFileSync(ExampleTextFileName).toString();
        const encodedText = encodeURIComponent(text);
        const postOptions = {
            method: "POST",
            uri: `http://semantic.netpeak.bg/`,
            body: `text=${encodedText}&submit=submit&${formHashKey}=${formHashValue}`,
            headers: {
                "Cookie": cookie,
                "Content-Type": "application/x-www-form-urlencoded"
            }
            // proxy: "http://localhost:8888", // Fiddler debugging
        };
        return request.post(postOptions);
    })
    .then(res => {
        const stopwords = readFileSync(StopwordsFileName).toString().split("\r\n");
        const html = cheerio.load(res);
        const words = html('tbody')
            .eq(1)
            .children()
            .map((index, childJS) => cheerio(childJS).children().first().text())
            .toArray()
            .filter(w => !stopwords.includes(w));
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
        const baseUrl = "http://www.textontologyproject.org/ontologies/textontologyproject#";
        const filteredDict = _.pickBy(dictWordNyms, _.identity);
        _.each(filteredDict, (hyponymObj, word) => {
            hyponymObj.url = `${baseUrl}${word}`;
            hyponymObj.parents = hyponymObj.parents || [];
            const candidateChildren = _.intersection(Object.keys(filteredDict).filter(w => w !== word), hyponymObj.hypernyms);
            hyponymObj.parents = hyponymObj.parents.concat(candidateChildren);
        });

        let ontologyXml = "";

        _.each(filteredDict, (objInfo, word) => {
            ontologyXml += `
            <owl:Class rdf:about="${objInfo.url}">
                ${ objInfo.parents.map(parent => `<rdfs:subClassOf rdf:resource="${baseUrl}${parent}"/>`).join("\n")}
                <rdfs:label xml:lang="en">${word}</rdfs:label>
                <skos:prefLabel xml:lang="en">${word}</skos:prefLabel>
            </owl:Class>`;
        });

        const templateText = readFileSync(TemplateFileName).toString();
        writeFileSync("1.owl", templateText.replace("__ONTOLOGY__", ontologyXml));
    })
    .catch(e => {
        console.error(e);
    });