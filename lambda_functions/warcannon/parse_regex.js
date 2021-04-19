'use strict';

var start = new Date();

const fs = require("fs");
const zlib = require('zlib')
const { Duplex } = require('stream');
const { WARCStreamTransform } = require('node-warc');
const { mime_types, regex_patterns } = require("./matches.js");

exports.main = function(parser) {

	let isLocal = false;
	let regexStartTime = 0;
	let recordStartTime = 0;
	const regexCost = {};
	const recordCost = { count: 0, total: 0 };

	if (fs.existsSync('/tmp/warcannon.testLocal')) {
		isLocal = true;
	}

	return new Promise((success, failure) => {
		process.send = (typeof process.send == "function") ? process.send : console.log;

		var metrics = {
			total_hits: 0,
			regex_hits: {}
		};

		Object.keys(regex_patterns).forEach((e) => {
			metrics.regex_hits[e] = {
				domains: {}
			};
		});

		var records = 0;
		var records_processed = 0;
		var last_status_report = new Date();

		parser.on('data', (record) => {

			records++;

			// Only process response records with mime-types we care about.
			if (record.warcHeader['WARC-Type'] != "response" || mime_types.indexOf(record.warcHeader['WARC-Identified-Payload-Type']) < 0) {
				return true;
			}

			records_processed++;

			if (isLocal) {
				recordStartTime = hrtime();
			}

			var domain = record.warcHeader['WARC-Target-URI'].split('/')[2];
			Object.keys(regex_patterns).forEach((e) => {
				if (isLocal) {
					if (!regexCost.hasOwnProperty(e)) {
						regexCost[e] = { count: 0, total: 0 };
					}

					regexStartTime = hrtime();
				}

				var matches = record.content.toString().match(regex_patterns[e]);

				if (isLocal) {
					regexCost[e].count++
					regexCost[e].total += hrtime() - regexStartTime;
				}

				if (matches != null) {
					metrics.total_hits++;

					if (!metrics.regex_hits[e].domains.hasOwnProperty(domain)) {
						metrics.regex_hits[e].domains[domain] = {
							"matches": [],
							"target_uris": []
						};
					};

					matches.forEach((m) => {
						if (m !== null) {
							metrics.regex_hits[e].domains[domain].matches.push(m.trim().replace(/['"]+/g, ""));
						}
					})

					if (metrics.regex_hits[e].domains[domain].target_uris.indexOf(record.warcHeader['WARC-Target-URI']) < 0) {
						metrics.regex_hits[e].domains[domain].target_uris.push(record.warcHeader['WARC-Target-URI']);
					}
				}
			});

			if (records_processed % 100 == 0 && new Date() - last_status_report > 1000) {
				last_status_report = new Date();
				process.send({type: "progress", recordcount: records});
			}

			if (isLocal) {
				recordCost.count++
				recordCost.total += hrtime() - recordStartTime;
			}

			return true;
		});

		parser.on('end', () => {
			
			process.send({message: metrics, type: "done"});

			if (isLocal) {
				console.log("--- Performance statistics ---");
				let record = roundAvg(recordCost.total, recordCost.count);
				console.log("Average per-record processing time: " + record + "ns");
				
				Object.keys(regexCost).forEach((e) => {
					let self = roundAvg(regexCost[e].total, regexCost[e].count);
					console.log(toFixedLength(e, 20) + " -  Self: " + self + "ns; Of record: " + Math.round(record / self * 100) / 100 + "%");
				});

				var total_mem = 0;
				var mem = process.memoryUsage();
				console.log("\n--- Memory statistics ---");
				for (let key in mem) {
					console.log(`${key} ${Math.round(mem[key] / 1024 / 1024 * 100) / 100} MB`);
					total_mem += mem[key];
				}

				console.log(`${Math.round(total_mem / 1024 / 1024 * 100) / 100} MB`);
				fs.writeFileSync('../../localResults.json', JSON.stringify(metrics));
			}

			success(metrics);
		});
	});
}
// Link process.send() to console.log() if there's no IPC;
function bufferToStream(myBuffer) {
    let tmp = new Duplex();
    tmp.push(myBuffer);
    tmp.push(null);
    return tmp;
}

function roundAvg(total, count, magnitude=1) {
	return Math.round(total * magnitude / count) / magnitude;
}

function toFixedLength(what, length) {
	what = (what.length <= length) ? what : what.substring(0, length - 3).concat('...');
	while (what.length < length) {
		what = what.concat(" ");
	}

	return what;
}

function hrtime() {
	let time = process.hrtime();
	return time[0] * 1000000000 + time[1];
}

if (process.argv.length == 3) {
	// console.log(process.argv);
	let warcFile = process.argv[2];
	if (!fs.existsSync(warcFile)) {
		console.log("Usage: " + process.argv[1] + " <file.warc>");
		process.exit();
	}

	/*const warcContent = { Body: fs.readFileSync(warcFile) };

	exports.main(bufferToStream(warcContent.Body)
				.pipe(zlib.createGunzip())
				.pipe(new WARCStreamTransform()));*/

	exports.main(fs.createReadStream(warcFile)
				.pipe(zlib.createGunzip())
				.pipe(new WARCStreamTransform()));
}