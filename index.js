const { readFileSync, writeFileSync } = require("fs");
const request = require("request-promise-native");
const _ = require("lodash");
const fs = require("fs");
const Thing = "THING";
const TemplateFileName = "template.owl";
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
                // const hyponyms = getNyms(responses);
                const hypernyms = getNyms(responses, r => r.hypernym);
                return { /*hyponyms, */hypernyms };
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
        const textValue = "%D0%9E%D1%80%D0%B8%D0%B3%D0%B8%D0%BD%D0%B0%D0%BB%D1%8A%D1%82%20%D0%BE%D1%82%201975%20%D0%B3%D0%BE%D0%B4%D0%B8%D0%BD%D0%B0%3A%20BMW%20%D0%A1%D0%B5%D1%80%D0%B8%D1%8F%203%20%D0%B5%20%D0%BE%D0%BB%D0%B8%D1%86%D0%B5%D1%82%D0%B2%D0%BE%D1%80%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BD%D0%B0%20%D1%81%D0%BF%D0%BE%D1%80%D1%82%D0%BD%D0%B0%20%D0%BB%D0%B8%D0%BC%D1%83%D0%B7%D0%B8%D0%BD%D0%B0.%20%D0%9D%D0%B5%D1%83%D1%81%D1%82%D0%BE%D0%B8%D0%BC%D0%B0%D1%82%D0%B0%20%D0%BA%D0%BE%D0%BC%D0%B1%D0%B8%D0%BD%D0%B0%D1%86%D0%B8%D1%8F%20%D0%BC%D0%B5%D0%B6%D0%B4%D1%83%20%D0%B4%D0%B8%D0%BD%D0%B0%D0%BC%D0%B8%D1%87%D0%B5%D0%BD%20%D0%B4%D0%B8%D0%B7%D0%B0%D0%B9%D0%BD%2C%20%D0%BD%D0%B5%D0%BF%D0%BE%D0%B4%D1%80%D0%B0%D0%B6%D0%B0%D0%B5%D0%BC%D0%B0%20%D0%BF%D1%8A%D1%80%D0%B3%D0%B0%D0%B2%D0%B8%D0%BD%D0%B0%20%D0%B8%20%D0%B2%D0%B8%D1%81%D0%BE%D0%BA%D0%B0%20%D0%BF%D1%80%D0%B8%D0%B3%D0%BE%D0%B4%D0%BD%D0%BE%D1%81%D1%82%20%D0%B7%D0%B0%20%D0%B2%D1%81%D0%B5%D0%BA%D0%B8%D0%B4%D0%BD%D0%B5%D0%B2%D0%B8%D0%B5%D1%82%D0%BE%20%D0%B2%D0%BF%D0%B5%D1%87%D0%B0%D1%82%D0%BB%D1%8F%D0%B2%D0%B0%20%D0%B8%20%D0%B2%20%D1%88%D0%B5%D1%81%D1%82%D0%BE%D1%82%D0%BE%20%D0%BF%D0%BE%D0%BA%D0%BE%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BD%D0%B0%20%D0%BC%D0%BE%D0%B4%D0%B5%D0%BB%D0%B0.%20%D0%9E%D0%BF%D1%82%D0%B8%D0%BC%D0%B0%D0%BB%D0%BD%D0%BE%D1%82%D0%BE%20%D1%80%D0%B0%D0%B7%D0%BF%D1%80%D0%B5%D0%B4%D0%B5%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BD%D0%B0%20%D1%82%D0%B5%D0%B3%D0%BB%D0%BE%D1%82%D0%BE%2C%20%D0%BA%D0%BB%D0%B0%D1%81%D0%B8%D1%87%D0%B5%D1%81%D0%BA%D0%BE%D1%82%D0%BE%20%D0%B7%D0%B0%D0%B4%D0%B2%D0%B8%D0%B6%D0%B2%D0%B0%D0%BD%D0%B5%20%D0%BD%D0%B0%20%D0%B7%D0%B0%D0%B4%D0%BD%D0%B8%D1%82%D0%B5%20%D0%BA%D0%BE%D0%BB%D0%B5%D0%BB%D0%B0%20%D0%B8%20%D0%BC%D0%BE%D1%89%D0%BD%D0%B8%D1%82%D0%B5%20%D0%B8%20%D0%B2%D0%B8%D1%81%D0%BE%D0%BA%D0%BE%20%D0%B5%D1%84%D0%B5%D0%BA%D1%82%D0%B8%D0%B2%D0%BD%D0%B8%20%D0%B1%D0%B5%D0%BD%D0%B7%D0%B8%D0%BD%D0%BE%D0%B2%D0%B8%20%D0%B8%20%D0%B4%D0%B8%D0%B7%D0%B5%D0%BB%D0%BE%D0%B2%D0%B8%20%D0%B4%D0%B2%D0%B8%D0%B3%D0%B0%D1%82%D0%B5%D0%BB%D0%B8%20%D1%81%20%D1%82%D0%B5%D1%85%D0%BD%D0%BE%D0%BB%D0%BE%D0%B3%D0%B8%D1%8F%20BMW%20EfficientDynamics%20%D0%BE%D1%81%D0%B8%D0%B3%D1%83%D1%80%D1%8F%D0%B2%D0%B0%D1%82%20%D0%B2%D0%BF%D0%B5%D1%87%D0%B0%D1%82%D0%BB%D1%8F%D0%B2%D0%B0%D1%89%D0%B0%20%D0%B4%D0%B8%D0%BD%D0%B0%D0%BC%D0%B8%D0%BA%D0%B0%20%D0%BF%D1%80%D0%B8%20%D0%BD%D0%B8%D1%81%D1%8A%D0%BA%20%D1%80%D0%B0%D0%B7%D1%85%D0%BE%D0%B4%20%D0%BD%D0%B0%20%D0%B3%D0%BE%D1%80%D0%B8%D0%B2%D0%BE.%20%D0%9D%D0%B0%D0%B9-%D0%B4%D0%BE%D0%B1%D1%80%D0%BE%D1%82%D0%BE%20%D1%81%D1%86%D0%B5%D0%BF%D0%BB%D0%B5%D0%BD%D0%B8%D0%B5%20%D0%BF%D1%80%D0%B8%20%D0%B2%D1%81%D1%8F%D0%BA%D0%B0%D0%BA%D0%B2%D0%B8%20%D1%83%D1%81%D0%BB%D0%BE%D0%B2%D0%B8%D1%8F%20%D1%81%D0%B5%20%D0%B3%D0%B0%D1%80%D0%B0%D0%BD%D1%82%D0%B8%D1%80%D0%B0%20%D0%BE%D1%82%20%D0%B8%D0%BD%D1%82%D0%B5%D0%BB%D0%B8%D0%B3%D0%B5%D0%BD%D1%82%D0%BD%D0%B0%D1%82%D0%B0%20%D1%81%D0%B8%D1%81%D1%82%D0%B5%D0%BC%D0%B0%20%D0%B7%D0%B0%20%D0%B4%D0%B2%D0%BE%D0%B9%D0%BD%D0%BE%20%D0%B7%D0%B0%D0%B4%D0%B2%D0%B8%D0%B6%D0%B2%D0%B0%D0%BD%D0%B5%20BMW%20xDrive.%20%D0%A1%20%D0%BE%D0%B1%D0%BE%D1%80%D1%83%D0%B4%D0%B2%D0%B0%D0%BD%D0%B5%D1%82%D0%BE%20%D0%9B%D0%B8%D0%BD%D0%B8%D1%8F%20Sport%2C%20%D0%9B%D0%B8%D0%BD%D0%B8%D1%8F%20Luxury%20%D0%B8%20%D0%9C%20%D0%A1%D0%BF%D0%BE%D1%80%D1%82%D0%BD%D0%B8%D1%8F%20%D0%BF%D0%B0%D0%BA%D0%B5%D1%82%20BMW%20%D0%A1%D0%B5%D1%80%D0%B8%D1%8F%203%20%D0%A1%D0%B5%D0%B4%D0%B0%D0%BD%20%D0%BC%D0%BE%D0%B6%D0%B5%20%D0%B4%D0%B0%20%D0%B1%D1%8A%D0%B4%D0%B5%20%D0%B0%D0%B4%D0%B0%D0%BF%D1%82%D0%B8%D1%80%D0%B0%D0%BD%D0%BE%20%D0%BA%D1%8A%D0%BC%20%D0%BB%D0%B8%D1%87%D0%BD%D0%B8%D1%82%D0%B5%20%D0%BC%D0%B8%20%D0%B6%D0%B5%D0%BB%D0%B0%D0%BD%D0%B8%D1%8F%20%D0%B8%20%D0%BF%D1%80%D0%B5%D0%B4%D0%BF%D0%BE%D1%87%D0%B8%D1%82%D0%B0%D0%BD%D0%B8%D1%8F.";
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