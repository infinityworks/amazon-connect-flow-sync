#!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const glob = require('glob-promise');
const AWS = require('aws-sdk');
const Connect = require('../connect');
const { promisify } = require('util');
const { writeFile, readFile } = require('fs');

const print = (str = '') => process.stdout.write(str);
const println = (str = '') => process.stdout.write(`${str}\n`);
const reprint = (str = '') => {
    process.stdout.clearLine();
    process.stdout.write(`\r${str}`);
};

let exitCode = 0;

program
    .option('-u, --username <login>', 'Connect admin username')
    .option('-p, --password <login>', 'Connect admin password')
    .option('-i, --instance-id <instanceId>', 'Connect instance UUID')
    .option('-c, --chrome <path>', 'Chromium path override')

const initConnect = async ({ instanceAlias, username, password, instanceId, chrome }) => {
    const auth = await Connect.getAuthType(instanceAlias);
    if (auth == Connect.AUTH_TYPE_FORM) {
        username = username || (await inquirer.prompt([{ type: 'input', name: 'username', message: 'Username:' }])).username;
        password = password || (await inquirer.prompt([{ type: 'password', name: 'password', message: 'Password:', mask: '*' }])).password;
        println(`💻 Starting headless chrome for ${instanceAlias}`);
        print(`🔑 Logging in as ${username}`);
    } else {
        if (instanceId === '') {
            throw new Error('instanceId is required for federated login');
        }
        const sts = new AWS.STS();
        const id = await sts.getCallerIdentity().promise();
        print(`🔑 Using AWS federated login for ${id.UserId.split(':').pop()}`)
    }
    const connect = await Connect(instanceAlias, { chromiumPath: chrome, username, password, instanceId });
    println(' ✔');
    return connect;
};

program
    .command('download <instanceAlias>')
    .alias('d')
    .description('download flows from connect')
    .option('-f, --filter <substring>', 'Flow search filter', '')
    .option('-d, --dest <path>', 'Download directory', '.')
    .option('--skip-unpublished', 'Does not download flows that have not been published')
    .action(async (instanceAlias, { filter, dest, skipUnpublished }) => {
        try {
            const connect = await initConnect({ instanceAlias, ...program });

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
                print(`📥 Downloading flows`);
                for (let f in flows) {
                    reprint(`📥 Downloading flows: ${f}/${flows.length} (${flows[f].name})`);
                    const flow = await connect.getFlow(flows[f]);
                    await promisify(writeFile)(`${dest}/${flows[f].name}.json`, JSON.stringify(flow, null, 2));
                };
                reprint(`📥 Downloading flows ${flows.length}/${flows.length}`);
                println(' ✔');
            }
        } catch (err) {
            println(` ❌ ${err}`);
            process.exit(-1);
        }
        println(`😎 Done`)
        process.exit(0);
    });

program
    .command('upload <instanceAlias>')
    .alias('u')
    .description('import flows into connect')
    .option('-s, --src <glob>', 'Flow files', './*.json')
    .option('--no-arn-fix', 'Dont let connect fix incorrect ARNs using matching resource name') 
    .option('--no-lambda-arn-fix', 'Dont coerce lambda ARN account numbers to match the account of the connect instance') 
    .option('--serverless-stage <stage>', 'Dont coerce lambda ARN account numbers to match the account of the connect instance') 
    .option('--no-publish', 'Save flows only. Do not publish')
    .action(async (instanceAlias, { src, arnFix, lambdaArnFix, publish, serverlessStage }) => {
        try {
            const connect = await initConnect({ instanceAlias, ...program });

            print(`🔍 Fetching current flow list from connect`)
            const currentFlows = await connect.listFlows();
            println(' ✔');

            print(`💿 Loading flows matching ${src}`)
            const files = await glob(src);
            print(` (${files.length} files)`)
            let flows = await Promise.all(files.map(f => promisify(readFile)(f)));
            flows = flows.map(f => JSON.parse(f)).filter(f => f && f.metadata && f.metadata.entryPointPosition && f.metadata.entryPointPosition.x);
            println(` ✔ ${flows.length} flows found`);

            if (flows.length == 0) {
                println('😢 No flows found')
            } else {
                print(`📤 Uploading flows`);
                for (let f in flows) {
                    reprint(`📤 Uploading flows: ${f}/${flows.length} (${flows[f].metadata.name})`);
                    const current = currentFlows.find(({name}) => name === flows[f].metadata.name)
                    if (!current) {
                        throw new Error(`no existing flow named ${flows[f].metadata.name}`)
                    }
                    await connect.uploadFlow(current.arn, JSON.stringify(flows[f]), { publish, fixARNs: arnFix, fixLambdaARNs: lambdaArnFix, serverlessStage })
                };
                reprint(`📤 Uploading flows ${flows.length}/${flows.length}`);
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