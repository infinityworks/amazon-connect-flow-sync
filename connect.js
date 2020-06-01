const puppeteer = require('puppeteer');

const startBrowser = async ({chromiumPath}={}) =>
    await puppeteer.launch({
        headless: false,
        executablePath: chromiumPath,
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
            //'--single-process',
            '--disable-extensions'
        ]
    });

const startPage = async browser => await browser.newPage();

const testInstanceId = instanceId => page => async () => {
    try {
        await page.goto(`https://${instanceId}.awsapps.com/connect`);
    } catch (err) {
        throw new Error(`invalid instance ID: ${instanceId}`)
    }
};

const login = instanceId => page => async (username, password) => {
    await page.goto(`https://${instanceId}.awsapps.com/connect/`);
    await page.waitForSelector('#wdc_username', { visible: true });
    await page.type('#wdc_username', username);
    await page.type('#wdc_password', password);
    await page.click('#wdc_login_button');
    const success = await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle0' }).then(() => true),
        page.waitForFunction(`document.querySelector('body') && document.querySelector('body').innerHTML.includes('Authentication Failed')`).finally(() => false),
    ]);
    if (!success) {
        throw new Error('Invalid username or password')
    }
}

const listFlows = instanceId => page => async ({filter}) =>
    await page.evaluate(async (instanceId, filter) => {
        const filterParam = filter ? `filter=%7B%22name%22:%22${filter}%22%7D&` : ''
        const res = await fetch(`https://${instanceId}.awsapps.com/connect/entity-search/contact-flows?${filterParam}&pageSize=100&startIndex=0`);
        const data = await res.json();
        return data.results.map(({ arn, name }) => ({ arn, name }));
    }, instanceId, filter);

const getFlow = instanceId => page => async ({ name, arn }) => 
    await page.evaluate(async (instanceId, arn) => {
        const res = await fetch(`https://${instanceId}.awsapps.com/connect/contact-flows/export?id=${arn}&status=published`);
        const data =  await res.json();
        return JSON.parse(data[0].contactFlowContent);
    }, instanceId, arn);

const getToken = async page =>
    await page.evaluate(() =>
        angular.element(document.getElementById('angularContainer')).scope().token);

module.exports = async (instanceId, {chromiumPath}) => {
    const browser = await startBrowser({chromiumPath});
    const page = await startPage(browser);
    await testInstanceId(instanceId)(page)()
    return {
        login: login(instanceId)(page),
        listFlows: listFlows(instanceId)(page),
        getFlow: getFlow(instanceId)(page),
        close: async () => await browser.close()
    }
}