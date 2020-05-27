const fs = require('fs');
const {promisify} = require('util');
const puppeteer = require('puppeteer');

const INSTANCE_ID = process.env.INSTANCE_ID;
const USERNAME = process.env.USERNAME;
const PASSWORD = process.env.PASSWORD;
const FLOW_FILTER = process.env.FLOW_FILTER || '';
const DOWNLOAD_PATH = process.env.DOWNLOAD_PATH || '.';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

const startBrowser = async () => {
    return await puppeteer.launch({
        headless: true,
        executablePath: CHROMIUM_PATH,
        args: [
            '--disable-gpu',
            '--renderer',
            '--no-sandbox',
            '--no-service-autorun',
            '--no-experiments',
            '--no-default-browser-check',
            '--disable-dev-shm-usage',
            '--disable-setuid-sandbox',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions'
        ]
    });
}

const startPage = async browser => {
    const page = await browser.newPage();
    await page._client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DOWNLOAD_PATH,
    });
    return page;
}

const login = async page => {
    // Go to login page.
    await page.goto(`https://${INSTANCE_ID}.awsapps.com/connect`);
    // Wait for page to load.
    await page.waitForSelector('#wdc_username', { visible: true });
    // Enter username and pasword.
    await page.type('#wdc_username', USERNAME);
    await page.type('#wdc_password', PASSWORD);
    // Submit login form.
    await page.click('#wdc_login_button');
    await page.waitForNavigation({ waitUntil: 'networkidle0' });
}

const listFlows = async page => {
    const filter = FLOW_FILTER != '' ? `filter=%7B%22name%22:%22${FLOW_FILTER}%22%7D&` : ''
    const flows = await page.evaluate(async (instanceId, filter) => {
        const res = await fetch(`https://${instanceId}.awsapps.com/connect/entity-search/contact-flows?${filter}&pageSize=100&startIndex=0`);
        const data = await res.json();
        return data.results.map(({ arn, name }) => ({ arn, name }));
    }, INSTANCE_ID, filter);
    return flows
}

const downloadFlow = async (page, {name, arn}) => {
    const flow = await page.evaluate(async (instanceId, arn) => {
        const res = await fetch(`https://${instanceId}.awsapps.com/connect/contact-flows/export?id=${arn}&status=published`);
        const data =  await res.json();
        return JSON.parse(data[0].contactFlowContent);
    }, INSTANCE_ID, arn);
    await promisify(fs.writeFile)(`${DOWNLOAD_PATH}/${name}.json`, JSON.stringify(flow, null, 2));
}

const print = (str='') => process.stdout.write(str);
const println = (str='') => process.stdout.write(`${str}\n`);
const reprint = (str='') => process.stdout.write(`\r${str}`);

(async () => {
    try {
        print(`💻 Starting headless chrome for ${INSTANCE_ID}`)
        const browser = await startBrowser();
        println(' ✔');
        
        print(`🔑 Logging in as ${USERNAME}`)
        const page = await startPage(browser);
        await login(page);
        println(' ✔');

        print(`🔍 Searching for flows${FLOW_FILTER !== '' ? ` with '${FLOW_FILTER}' in their name` : ''}`)
        const flows = await listFlows(page);
        println(' ✔');
        
        if (flows.length === 0) {
            println('😢 No flows found')
            return
        }

        print(`📥 Downloading flows: 0/${flows.length}`);
        for (let f in flows) {
            await downloadFlow(page, flows[f]);
            reprint(`📥 Downloading flows: ${parseInt(f)+1}/${flows.length}`);
        };
        println(' ✔');

        print(`🧹 Tidying up`);
        await browser.close()
        println(' ✔');    
    } catch (err) {
        println(` ❌ ${err}`);
        process.exit(-1);
    }
    process.exit(0);
})()