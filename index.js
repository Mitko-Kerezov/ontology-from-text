const { readFileSync, writeFileSync } = require("fs");
const request = require("request-promise-native");
const _ = require("lodash");
const fs = require("fs");
const cheerio = require("cheerio");

const Thing = "Thing";
const TemplateFileName = "template.owl";
const ExampleTextFileName = "text.txt";
const StopwordsFileName = "stopwords.txt";

let posTaggedText = readFileSync(ExampleTextFileName).toString();
let wordsDict = {};

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

    return request.post(options).then(result => ({
        result,
        body
    }));
}

function getNyms(responses, mapLambda = r => r.result.hypernym) {
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
            const { results } = response.result;
            const isNounFilter = r => r.pos === "n";
            const shouldGetNeighbours = _.some(results, isNounFilter);
            const word = response.body.query;
            const wordsToReplace = (wordsDict.filter(w => w.key == word)[0].value).filter(Boolean);
            if (shouldGetNeighbours) {
                wordsToReplace.forEach(wordToReplace => {
                    const regEx = new RegExp(wordToReplace, "ig");
                    posTaggedText = posTaggedText.replace(regEx, `NN_${word}`);
                });
                const allNounsIds = _(results).filter(isNounFilter).map(r => r.id).value();
                return Promise.all(_.map(allNounsIds,
                    id => {
                        const neighboursBody = {
                            id,
                            verified: true
                        };
                        return postToBulnetPromise(neighboursBody, "neighbours");
                    }));
            } else {
                wordsToReplace.forEach(wordToReplace => {
                    const regEx = new RegExp(wordToReplace, "ig");
                    if (results[0]) {
                        posTaggedText = posTaggedText.replace(regEx, `${results[0].pos}_${word}`);
                    }
                });
            }
        })
        .then(responses => {
            if (responses) {
                const hypernyms = getNyms(responses);
                return { hypernyms };
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

const nounGreedyWithCaptureGroup = "NN_([а-я]+)";
const nounGreedyWithoutCaptureGroup = "NN_[а-я]+";
const allPunctuation = `[.?!:'"]`;
const suchAsRegex = new RegExp(`NN_([а-я]+?) (?:, )?като (?:например )?(?:(.*?)${allPunctuation})`, "gim");
const andOthersRegex = new RegExp(`( (?:NN_[а-я]+?(?:, ))+NN_[а-я]+?) и други NN_([а-я]+?)${allPunctuation}`, "gim");
const andSomeoneElseRegex = new RegExp(`((?:${nounGreedyWithoutCaptureGroup}(?:, )?)*) или някой друг ${nounGreedyWithCaptureGroup}`, "gim");
const regex4 = new RegExp(`${nounGreedyWithCaptureGroup}(?:, )?a_особен ${nounGreedyWithCaptureGroup}`, "gim");
const regex5 = new RegExp(`${nounGreedyWithCaptureGroup}(?:, )?p_включително ${nounGreedyWithCaptureGroup}`, "gim");

function getAllRegexMatches(regexText, text) {
    let result = [];
    _(text.split(/[ ,.:'"!?]/)).filter(Boolean).each(word => {
        let match;
        const regex = new RegExp(regexText, "gim");
        do {
            match = regex.exec(word);
            if (match) {
                result.push(match[1]);
            }
        } while (match);
    });
    return result;
}

function applyHearstRegexes(filteredDict) {
    console.log(filteredDict);
    const appendHypernyms = (hyponyms, hyperonym) => {
        _.each(hyponyms, hyponym => {
            filteredDict[hyponym] = filteredDict[hyponym] || { hypernyms: [] };
            filteredDict[hyponym].hypernyms.push(hyperonym);
        });
    }
    let match;

    const executeRegex = (regex, hyponymsLambda, hyperonymsLambda) => {
        do {
            match = regex.exec(posTaggedText);
            if (match) {
                appendHypernyms(hyponymsLambda(match), hyperonymsLambda(match));
            }
        } while (match);
    };
    const getFirstMatch = match => match[1];
    const getSecondMatch = match => match[2];
    executeRegex(suchAsRegex, match => getAllRegexMatches(nounGreedyWithCaptureGroup, match[2]), getFirstMatch);
    executeRegex(andOthersRegex, match => getAllRegexMatches(nounGreedyWithCaptureGroup, match[1]), getSecondMatch);
    executeRegex(andSomeoneElseRegex, match => getAllRegexMatches(nounGreedyWithCaptureGroup, match[1]), getSecondMatch);
    executeRegex(regex4, match => [match[2]], getFirstMatch);
    executeRegex(regex5, match => [match[2]], getFirstMatch);

}

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
        wordsDict = html('tbody')
            .eq(1)
            .children()
            .toArray()
            .reduce((dict, childJS) => {
                var currentWord = cheerio(childJS).children().first().text();
                if (!stopwords.includes(currentWord)) {
                    dict.push({
                        key: cheerio(childJS).children().first().text(),
                        value: cheerio(childJS).children().eq(1).text().trim().split(' ')
                    });
                }

                return dict;
            }, []);

        const promises = _.map(wordsDict, keyValuePair => {
            return getNymsObject(keyValuePair.key)
                .then(obj => {
                    dictWordNyms[keyValuePair.key] = obj;
                    console.log("word", keyValuePair.key)
                });
        });

        return Promise.all(promises);
    })
    .then(res => {
        console.log(posTaggedText);
        const baseUrl = "http://www.textontologyproject.org/ontologies/textontologyproject#";
        const filteredDict = _.pickBy(dictWordNyms, _.identity);
        applyHearstRegexes(filteredDict);
        _.each(filteredDict, (hyponymObj, word) => {
            hyponymObj.url = `${baseUrl}${word}`;
            hyponymObj.parents = hyponymObj.parents || [];
            const candidateChildren = _.intersection(Object.keys(filteredDict).filter(w => w !== word), hyponymObj.hypernyms);
            hyponymObj.parents = _.uniq(hyponymObj.parents.concat(candidateChildren));
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
        writeFileSync("test.owl", templateText.replace("__ONTOLOGY__", ontologyXml));
    })
    .catch(e => {
        console.error(e);
    });