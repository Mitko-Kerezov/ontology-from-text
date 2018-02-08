const { readFileSync, writeFileSync } = require("fs");
const request = require("request-promise-native");
const _ = require("lodash");
const fs = require("fs");
const cheerio = require("cheerio");

const Thing = "Thing";
const TemplateFileName = "template.owl";
const ExampleTextFileName = "text.txt";
const StopwordsFileName = "stopwords.txt";
const baseUrl = "http://www.textontologyproject.org/ontologies/textontologyproject#";
const nonCyrilicLetterRegexCharacter = "[^а-я]";

if (process.argv.length < 3) {
    console.error(`No argument provided.\nSample usage:\n\t${process.argv[0]} ${process.argv[1]} <path-to-file>`);
    return 1;
}

let posTaggedText = getText(ExampleTextFileName);
let wordsDict = {};

function getText(fileName) {
    return readFileSync(fileName).toString();
}

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

function getAllNeighbours(allNounsIds) {
    return Promise.all(_.map(allNounsIds,
        id => {
            const neighboursBody = {
                id,
                verified: true
            };
            return postToBulnetPromise(neighboursBody, "neighbours");
        }));
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
                    const regEx = new RegExp(`(${nonCyrilicLetterRegexCharacter})${wordToReplace}(${nonCyrilicLetterRegexCharacter})`, "ig");
                    posTaggedText = posTaggedText.replace(regEx, `$1NN_${word}$2`);
                });
                const allNounsIds = _(results).filter(isNounFilter).map(r => r.id).value();
                return getAllNeighbours(allNounsIds);
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
const suchAsRegex = new RegExp(`NN_([а-я]+?) (?:, )?като (?:например )?(${nounGreedyWithoutCaptureGroup}(?: и ${nounGreedyWithoutCaptureGroup})?)`, "gim");
const andOthersRegex = new RegExp(`( (?:${nounGreedyWithoutCaptureGroup}?(?:, ))+${nounGreedyWithoutCaptureGroup}?) и други NN_([а-я]+?)${allPunctuation}`, "gim");
const andSomeoneElseRegex = new RegExp(`((?:${nounGreedyWithoutCaptureGroup}(?:, )?)*) или някой друг ${nounGreedyWithCaptureGroup}`, "gim");
const regex4 = new RegExp(`${nounGreedyWithCaptureGroup}(?:, )?a_особен ${nounGreedyWithCaptureGroup}`, "gim");
const regex5 = new RegExp(`${nounGreedyWithCaptureGroup}(?:, )?p_включително ${nounGreedyWithCaptureGroup}`, "gim");
const containsRegex = new RegExp(`${nounGreedyWithCaptureGroup}\\s*v_съдържам:\\s(.*?)[.]`, "gim");
const vitaminsRegex = new RegExp(`(витамин) ([А-Я]\\d?)`, "gm");
const countriesRegex = new RegExp(`(държава):? ((?:[a-z][a-z]?_[а-я]+[ ,] ?)+)`, "gim");
const containsValuesRegex = new RegExp(`${nounGreedyWithCaptureGroup}\\s*(\\d+)`, "gim");

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

function applyIndividualsRegexes(filteredDict) {
    let match;
    do {
        match = vitaminsRegex.exec(posTaggedText);
        if (match) {
            filteredDict[match[1]].individuals = filteredDict[match[1]].individuals || new Set();
            filteredDict[match[1]].individuals.add(match[2]);
        }
    } while (match);

    do {
        match = countriesRegex.exec(posTaggedText);
        if (match) {
            filteredDict[match[1]].individuals = filteredDict[match[1]].individuals || new Set();
            getAllRegexMatches(nounGreedyWithCaptureGroup, match[2]).forEach(i => {
                delete filteredDict[i];
                filteredDict[match[1]].individuals.add(i)
            });
        }
    } while (match);
}

function applyPropertyRegexes(filteredDict) {
    let match;
    do {
        match = containsRegex.exec(posTaggedText);
        if (match) {
            const classKey = match[1];
            let valuesMatch;
            do {
                valuesMatch = containsValuesRegex.exec(match[2]);
                if (valuesMatch) {
                    filteredDict[classKey].properties = filteredDict[classKey].properties || {};
                    filteredDict[classKey].properties[valuesMatch[1]] = valuesMatch[2];
                }
            } while (valuesMatch);
        }
    } while (match);
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

function parseNetPeakResponse(res) {
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
}

function getOntologyXml(filteredDict) {
    let ontologyXml = "";

    _.each(filteredDict, (objInfo, word) => {
        if (objInfo) {
            _(objInfo.properties)
                .keys()
                .each(prop => {
                    delete filteredDict[prop];
                    ontologyXml += `
                    <${baseUrl}${prop}>
                        a owl:DatatypeProperty .
                    `;
                });
        }
    });

    _.each(filteredDict, (objInfo, word) => {
        const objTurtleUrl = `<${objInfo.url}>`;
        ontologyXml += `
                ${objTurtleUrl}
                a owl:Class ;
                ${ objInfo.properties ? Object.keys(objInfo.properties).map(prop => `<${baseUrl}${prop}> "${objInfo.properties[prop]}"^^xsd:integer ;`).join("\n\t") : ''}
                ${ objInfo.parents.map(parent => `rdfs:subClassOf <${baseUrl}${parent}> ;`).join("\n\t")}
                rdfs:label "${word}"@bg ;
                skos:prefLabel "${word}"@bg .`;

        if (objInfo.individuals) {
            objInfo.individuals.forEach(individual => {
                ontologyXml += `
                <${baseUrl}${individual}>
                a owl:Thing, ${objTurtleUrl} .`;
            });
        }
    });

    return ontologyXml;
}

function createOntologyConnections(filteredDict) {
    _.each(filteredDict, (hyponymObj, word) => {
        hyponymObj.url = `${baseUrl}${word}`;
        hyponymObj.parents = hyponymObj.parents || [];
        const candidateChildren = _.intersection(Object.keys(filteredDict).filter(w => w !== word), hyponymObj.hypernyms);
        hyponymObj.parents = _.uniq(hyponymObj.parents.concat(candidateChildren));
    });
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
    .then(parseNetPeakResponse)
    .then(res => {
        console.log(posTaggedText);
        const filteredDict = _.pickBy(dictWordNyms, _.identity);
        applyHearstRegexes(filteredDict);
        applyPropertyRegexes(filteredDict);
        applyIndividualsRegexes(filteredDict);

        createOntologyConnections(filteredDict);
        const ontologyXml = getOntologyXml(filteredDict);

        const templateText = readFileSync(TemplateFileName).toString();
        writeFileSync("ontology.owl", templateText.replace("__ONTOLOGY__", ontologyXml));
    })
    .catch(e => {
        console.error(e);
    });