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
    // Go to flows list page.
    await page.goto(`https://${INSTANCE_ID}.awsapps.com/connect/contact-flows#?name=${FLOW_FILTER}`);
    // Wait for the list to load.
    await page.waitForSelector('a[href^="contact-flows/edit?"]', { visible: true });
    // Get all the links from the table.
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href^="contact-flows/edit?"'), el => el.href));
    // Extract the ARNs.
    return hrefs.map(h => h.match(/contact-flows\/edit\?id=(.+)/)).flatMap(m => m && m.length>=2 ? [m[1]] : []);
}

const downloadFlow = async (page, flowId) => {
    // Go to the edit page.
    await page.goto(`https://${INSTANCE_ID}.awsapps.com/connect/contact-flows/edit?id=${flowId}`);
    // Wait for the flow to finish loading (there are boxes in the svg).
    await page.waitForFunction(() => document.querySelectorAll("#contact-flow-outer-area #paper svg foreignObject").length > 0);
    // Click the export flow button in the dropdown menu.
    await page.evaluate(() => Array.from(document.querySelectorAll("#cf-dropdown a")).find(e => e.textContent.includes("Export flow")).click());
    // Add .json to the end of the file path.
    await page.type('input[ng-model="filename"]', '.json');
    // Click on export button.
    await page.evaluate(() => document.querySelector('awsui-button[text="Export"] button').click());
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

        let fetched = 0;
        print(`📥 Downloading flows: 0/${flows.length}`);
        await Promise.all(flows.map(async id => {
            const p = await startPage(browser);
            await downloadFlow(p, id);
            fetched++;
            reprint(`📥 Downloading flows: ${fetched}/${flows.length}`);
        }));
        println(' ✔');

        await page.waitFor(3000);

        print(`🧹 Tidying up`);
        await browser.close()
        println(' ✔');    
    } catch (err) {
        println(`❌ ${err}`);
        process.exit(-1);
    }
    process.exit(0);
})()