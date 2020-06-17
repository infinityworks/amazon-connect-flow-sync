#!/usr/bin/env node

const { program } = require('commander');
const inquirer = require('inquirer');
const glob = require('glob-promise');
const AWS = require('aws-sdk');
const Connect = require('../connect');
const { writeFile, readFile } = require('fs').promises;

const print = (str = '') => process.stdout.write(str);
const println = (str = '') => process.stdout.write(`${str}\n`);
const reprint = (str = '') => {
    process.stdout.clearLine();
    process.stdout.write(`\r${str}`);
};

program
    .name("connect-sync")
    .usage("[auth options] <command> <instance_alias>")
    .option('-u, --username <login>', 'Connect admin username (non-federated login)')
    .option('-p, --password <login>', 'Connect admin password (non-federated login)')
    .option('-i, --instance-id <instanceId>', 'Connect instance UUID (federated login)')
    .option('-c, --chrome <path>', 'Chromium path override (non-federated login)')
    .on('--help', () => {
        console.log('');
        console.log('Examples:');
        console.log('  SAML2 login:');
        console.log('    AWS_PROFILE=profile-with-permissions connect-sync --instance-id 12345678-9012-3456-7890-123456789012 <command> <instance_url>');
        console.log('  Connect/AD login:');
        console.log('    connect-sync --username cicd_admin_user --password "c1cd_pAssw0rd!"2 <command> <instance_url>');
        console.log('  Connect/AD login (prompt for password):');
        console.log('    connect-sync --username admin_user <command> <instance_url>');
    })

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
        print(`🔑 Using AWS federated login for ${id.UserId.split(':').pop()}`);
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
    .on('--help', () => {
        console.log('');
        console.log('Example:');
        console.log('  connect-sync -u admin download my-connect-app -f "login_" -d ./login-flows --skip-unpublished');
    })
    .action(async (instanceAlias, { filter, dest, skipUnpublished }) => {
        try {
            const connect = await initConnect({ instanceAlias, ...program });

            print(`🔍 Searching for flows${filter !== '' ? ` with '${filter}' in their name` : ''}`);
            let flows = await connect.listFlows({ filter });
            println(' ✔');

            let unpublished = flows.filter(f => f.contactFlowStatus !== 'published');
            if (skipUnpublished && unpublished.length) {
                println(`🦘 Skipping unpublished flows: ${unpublished.map(f => f.name).join(',')}`);
                flows = flows.filter(f => f.contactFlowStatus === 'published');
            }
            if (flows.length == 0) {
                println('😢 No flows found');
            } else {
                print(`📥 Downloading flows`);
                for (let f in flows) {
                    reprint(`📥 Downloading flows: ${f}/${flows.length} (${flows[f].name})`);
                    const flow = await connect.getFlow(flows[f]);
                    const fileContent = JSON.stringify(flow, null, 2).replace(/\n\s{10,}/g, " ").replace(/\n\s{8}}/g, " }");
                    await writeFile(`${dest}/${flows[f].name}.json`, fileContent);
                };
                reprint(`📥 Downloading flows ${flows.length}/${flows.length}`);
                println(' ✔');
            }
        } catch (err) {
            println(` ❌ ${err}`);
            process.exit(-1);
        }
        println(`😎 Done`);
        process.exit(0);
    });

program
    .command('upload <instanceAlias>')
    .alias('u')
    .description('import flows into connect')
    .option('-s, --src <glob>', 'Flow files', './*.json')
    .option('--no-arn-fix', 'Dont let connect fix incorrect ARNs using matching resource name') 
    .option('--no-lambda-arn-fix', 'Dont coerce lambda ARN account numbers to match the account of the connect instance') 
    .option('--serverless-stage <stage>', 'Modify serverless framework lambda named by setting the stage')
    .option('--encryption-id <uuid>', 'Update the ID of the encryption key used for encrypting customer input')
    .option('--encryption-cert <path.pem>', 'Update the certificate of the encryption key used for encrypting customer input')
    .option('--no-publish', 'Save flows only. Do not publish')
    .on('--help', () => {
        console.log('');
        console.log('Example:');
        console.log('  connect-sync -u admin upload my-connect-app -s "./login-flows/*.json" --serverless-stage prod');
    })
    .action(async (instanceAlias, { src, arnFix, lambdaArnFix, publish, serverlessStage, encryptionId, encryptionCert }) => {
        try {
            const connect = await initConnect({ instanceAlias, ...program });

            print(`🔍 Fetching current flow list from connect`);
            const currentFlows = await connect.listFlows();
            println(' ✔');

            print(`💿 Loading flows matching ${src}`);
            const files = await glob(src);
            print(` (${files.length} files)`);
            let flows = await Promise.all(files.map(f => readFile(f)));
            flows = flows.map(f => JSON.parse(f)).filter(f => f && f.metadata && f.metadata.entryPointPosition && f.metadata.entryPointPosition.x);
            println(` ✔ ${flows.length} flows found`);

            let encryptionCertPem;
            if (encryptionCert) {
                print(`📜 Loading certificate file from ${encryptionCert}`);
                encryptionCertPem = await readFile(encryptionCert);
                if (!encryptionCertPem.includes("-BEGIN CERTIFICATE-") || !encryptionCertPem.includes("-END CERTIFICATE-")) {
                    throw new Error("invalid pem file");
                }
                println(` ✔`);
            }

            if (flows.length == 0) {
                println('😢 No flows found');
            } else {
                print(`📤 Uploading flows`);
                for (let f in flows) {
                    reprint(`📤 Uploading flows: ${f}/${flows.length} (${flows[f].metadata.name})`);
                    const current = currentFlows.find(({name}) => name === flows[f].metadata.name);
                    if (!current) {
                        throw new Error(`no existing flow named ${flows[f].metadata.name}`);
                    }
                    await connect.uploadFlow(current.arn, JSON.stringify(flows[f]), { publish, fixARNs: arnFix, fixLambdaARNs: lambdaArnFix, serverlessStage, encryptionId, encryptionCert: encryptionCertPem });
                };
                reprint(`📤 Uploading flows ${flows.length}/${flows.length}`);
                println(' ✔');
            }
        } catch (err) {
            println(` ❌ ${err}`);
            process.exit(-1);
        }
        println(`😎 Done`);
        process.exit(0);
    });

program.parse(process.argv);