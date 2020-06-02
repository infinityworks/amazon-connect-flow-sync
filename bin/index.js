#!/usr/bin/env node

const program = require('commander');
const inquirer = require('inquirer');
const Connect = require('../connect');
const { promisify } = require('util');
const { writeFile } = require('fs');

const print = (str = '') => process.stdout.write(str);
const println = (str = '') => process.stdout.write(`${str}\n`);
const reprint = (str = '') => process.stdout.write(`\r${str}`);

let exitCode = 0;

program
    .command('export <instanceId>')
    .alias('e')
    .description('download flows from connect')
    .option('-u, --username <login>', 'Connect admin username')
    .option('-p, --password <login>', 'Connect admin password')
    .option('-f, --filter <substring>', 'Flow search filter', '')
    .option('-d, --dest <path>', 'Download directory', '.')
    .option('-c, --chrome <path>', 'Chromium path override')
    .option('--skip-unpublished', 'Does not download flows that have not been published')
    .action(async (instanceId, { username, password, filter, dest, chrome, skipUnpublished }) => {
        try {
            const auth = await Connect.getAuthType(instanceId);
            if (auth == Connect.AUTH_TYPE_FORM) {
                username = username || (await inquirer.prompt([{ type: 'input', name: 'username', message: 'Username:' }])).username;
                password = password || (await inquirer.prompt([{ type: 'password', name: 'password', message: 'Password:', mask: '*' }])).password;
            }            
            
            println(`💻 Starting headless chrome for ${instanceId}`)
            print(`🔑 Logging in as ${username}`)
            const connect = await Connect(instanceId, { chromiumPath: chrome, username, password });
            println(' ✔');

            print(`🔍 Searching for flows${filter !== '' ? ` with '${filter}' in their name` : ''}`)
            let flows = await connect.listFlows({ filter });
            println(' ✔');

            let unpublished = flows.filter(f => f.contactFlowStatus !== 'published')
            if (skipUnpublished && unpublished.length) {
                println(`🦘 Skipping unpublished flows: ${unpublished.map(f => f.name).join(',')}`);
                flows = flows.filter(f => f.contactFlowStatus === 'published')
            }
            if (flows.length == 0) {
                println('😢 No flows found')
            } else {
                print(`📥 Downloading flows: 0/${flows.length}`);
                for (let f in flows) {
                    const flow = await connect.getFlow(flows[f]);
                    await promisify(writeFile)(`${dest}/${flows[f].name}.json`, JSON.stringify(flow, null, 2));
                    reprint(`📥 Downloading flows: ${parseInt(f) + 1}/${flows.length}`);
                };
                println(' ✔');
            }
        } catch (err) {
            println(` ❌ ${err}`);
            process.exit(-1);
        }
        println(`😎 Done`)
        process.exit(0);
    });

program.parse(process.argv);