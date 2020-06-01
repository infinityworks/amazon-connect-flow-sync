#!/usr/bin/env node

const program = require('commander');
const inquirer = require('inquirer');
const Connect = require('../connect');
const { promisify } = require('util');
const { writeFile } = require('fs');

const print = (str = '') => process.stdout.write(str);
const println = (str = '') => process.stdout.write(`${str}\n`);
const reprint = (str = '') => process.stdout.write(`\r${str}`);

program
    .command('export <instanceId>')
    .alias('e')
    .description('download flows from connect')
    .option('-u, --username <login>', 'Connect admin username')
    .option('-p, --password <login>', 'Connect admin password')
    .option('-f, --filter <substring>', 'Flow search filter', '')
    .option('-d, --dest <path>', 'Download directory', '.')
    .option('-c, --chrome <path>', 'Chromium path override')
    .action(async (instanceId, { username, password, filter, dest, chrome }) => {
        try {
            print(`💻 Starting headless chrome for ${instanceId}`)
            const connect = await Connect(instanceId, { chromiumPath: chrome });
            println(' ✔');

            username = username || (await inquirer.prompt([{ type: 'input', name: 'username', message: 'Username:' }])).username;
            password = password || (await inquirer.prompt([{ type: 'password', name: 'password', message: 'Password:', mask: '*' }])).username;

            print(`🔑 Logging in as ${username}`)
            await connect.login(username, password);
            println(' ✔');

            print(`🔍 Searching for flows${filter !== '' ? ` with '${filter}' in their name` : ''}`)
            const flows = await connect.listFlows({ filter });
            println(' ✔');

            if (flows.length > 0) {
                print(`📥 Downloading flows: 0/${flows.length}`);
                for (let f in flows) {
                    const flow = await connect.getFlow(flows[f]);
                    promisify(writeFile)(`${dest}/${flows[f].name}.json`, JSON.stringify(flow, null, 2));
                    reprint(`📥 Downloading flows: ${parseInt(f) + 1}/${flows.length}`);
                };
                println(' ✔');
            } else {
                println('😢 No flows found')
            }

            print(`🧹 Tidying up`);
            await connect.close()
            println(' ✔');
        } catch (err) {
            println(` ❌ ${err}`);
            process.exit(-1);
        }
        process.exit(0);
    });

program.parse(process.argv);