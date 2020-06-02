const fetch = require('node-fetch')
const FormData = require('form-data');
const puppeteer = require('puppeteer');

const AUTH_TYPE_FORM = Symbol("Form");
const AUTH_TYPE_FEDERATED = Symbol("Federated");

const startBrowser = async ({ chromiumPath } = {}) =>
    await puppeteer.launch({
        headless: true,
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
            '--single-process',
            '--disable-extensions'
        ]
    });

const getAuthType = async instanceId => {
    try {
        const form = new FormData()
        form.append('directoryAliasOrId', instanceId)
        form.append('landat', '/connect/home')
        const res = await fetch(`https://${instanceId}.awsapps.com/connect/login/redirect`, {
            method: 'POST',
            redirect: 'manual',
            body: form
        });
        const redirect = await res.headers.get('Location');
        return redirect === null ? AUTH_TYPE_FEDERATED : AUTH_TYPE_FORM
    } catch (err) {
        console.log(err)
        throw new Error(`invalid instance ID: ${instanceId}`)
    }
};

const loginForm = (instanceId, chromiumPath) => async (username, password) => {
    const browser = await startBrowser({ chromiumPath });
    try {
        const page = await browser.newPage()
        await page.goto(`https://${instanceId}.awsapps.com/connect/home`);
        await page.waitForSelector('#wdc_username', { visible: true });
        await page.type('#wdc_username', username);
        await page.type('#wdc_password', password);
        await page.click('#wdc_login_button');
        const success = await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle0' }).then(() => true),
            page.waitForFunction(`document.querySelector('body') && document.querySelector('body').innerHTML.includes('Authentication Failed')`).then(() => false),
        ]);
        if (!success) {
            throw new Error('Invalid username or password')
        }
        const cookies = await page.cookies()
        return cookies.find(c => c.name === "lily-auth-prod-lhr").value;
    } finally {
        await browser.close()
    }
}

const listFlows = (instanceId, token) => async ({ filter }={}) => {
    if (!token) {
        throw new Error('not logged in');
    }
    const filterParam = filter ? `filter=%7B%22name%22:%22${filter}%22%7D&` : ''
    const res = await fetch(`https://${instanceId}.awsapps.com/connect/entity-search/contact-flows?${filterParam}&pageSize=100&startIndex=0`, {
        headers: {
            cookie: `lily-auth-prod-lhr=${token}`
        },
    });
    const data = await res.json();
    return data.results;
}

const getFlow = (instanceId, token) => async ({ arn, contactFlowStatus = 'published', name, description, contactFlowType }) => {
    if (!token) {
        throw new Error('not logged in');
    }
    const res = await fetch(`https://${instanceId}.awsapps.com/connect/contact-flows/export?id=${arn}&status=${contactFlowStatus}`, {
        headers: {
            cookie: `lily-auth-prod-lhr=${token}`
        },
    });
    const data = await res.json();
    const flow = JSON.parse(data[0].contactFlowContent);
    flow.metadata.status = data[0].contactFlowStatus;
    flow.metadata.name = name;
    flow.metadata.description = description;
    flow.metadata.type = contactFlowType;
    return flow;
}

const getToken = async page =>
    await page.evaluate(() =>
        angular.element(document.getElementById('angularContainer')).scope().token);

module.exports = async (instanceId, { chromiumPath, username, password }) => {
    const auth = await getAuthType(instanceId)
    if (auth == AUTH_TYPE_FEDERATED) {
        throw new Error('cannot handle federated instances...yet');
    }
    let token = await loginForm(instanceId, chromiumPath)(username, password);
    return {
        listFlows: listFlows(instanceId, token),
        getFlow: getFlow(instanceId, token),
    }
}

module.exports.AUTH_TYPE_FORM = AUTH_TYPE_FORM;
module.exports.AUTH_TYPE_FEDERATED = AUTH_TYPE_FEDERATED;
module.exports.getAuthType = getAuthType;
