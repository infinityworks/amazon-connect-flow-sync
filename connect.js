const fetch = require('node-fetch')
const AWS = require('aws-sdk');
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

const getAuthType = async instanceAlias => {
    try {
        const form = new FormData();
        form.append('directoryAliasOrId', instanceAlias);
        form.append('landat', '/connect/home');
        const res = await fetch(`https://${instanceAlias}.awsapps.com/connect/login/redirect`, {
            method: 'POST',
            redirect: 'manual',
            body: form
        });
        const redirect = await res.headers.get('Location');
        return redirect === null ? AUTH_TYPE_FEDERATED : AUTH_TYPE_FORM;
    } catch (err) {
        throw new Error(`invalid instance ID: ${instanceAlias}`);
    }
};

const loginForm = async (instanceAlias, username, password, { chromiumPath }) => {
    const browser = await startBrowser({ chromiumPath });
    try {
        const page = await browser.newPage();
        await page.goto(`https://${instanceAlias}.awsapps.com/connect/home`);
        await page.waitForSelector('#wdc_username', { visible: true });
        await page.type('#wdc_username', username);
        await page.type('#wdc_password', password);
        await page.click('#wdc_login_button');
        const success = await Promise.race([
            page.waitForNavigation({ waitUntil: 'networkidle0' }).then(() => true),
            page.waitForFunction(`document.querySelector('body') && document.querySelector('body').innerHTML.includes('Authentication Failed')`).then(() => false),
        ]);
        if (!success) {
            throw new Error('Invalid username or password');
        }
        const cookies = await page.cookies();
        return cookies.find(c => c.name === "lily-auth-prod-lhr").value;
    } finally {
        await browser.close();
    }
};

const loginFederated = async (instanceId) => {
    const connect = new AWS.Connect();
    const res = await connect.getFederationToken({ InstanceId: instanceId }).promise();
    return res.Credentials.AccessToken;
};

const fetchAuth = token => ({
    headers: {
        cookie: `lily-auth-prod-lhr=${token}`
    },
});

const listFlows = (instanceAlias, token) => async ({ filter }={}) => {
    if (!token) {
        throw new Error('not logged in');
    }
    const filterParam = filter ? `filter=%7B%22name%22:%22${filter}%22%7D&` : ''
    const res = await fetch(`https://${instanceAlias}.awsapps.com/connect/entity-search/contact-flows?${filterParam}&pageSize=100&startIndex=0`, fetchAuth(token));
    const data = await res.json();
    return data.results;
};

const getFlow = (instanceAlias, token) => async ({ arn, contactFlowStatus = 'published', name, description, contactFlowType }) => {
    if (!token) {
        throw new Error('not logged in');
    }
    const res = await fetch(`https://${instanceAlias}.awsapps.com/connect/contact-flows/export?id=${arn}&status=${contactFlowStatus}`, fetchAuth(token));
    const data = await res.json();
    const flow = JSON.parse(data[0].contactFlowContent);
    // Handle old metadata format - conver to new format.
    if (Array.isArray(flow.metadata)) {
        flow.metadata = flow.metadata.reduce((acc, obj) => ({...acc, ...obj}), {})
    }
    // Enforce a consistent ordering of modules to help source control to track real changes.
    // Also fix connect's broken grid snapping sometimes moving things around unexpectedly.
    const gridSize = flow.metadata.snapToGrid ? 20 : 0
    flow.metadata.entryPointPosition.x = Math.round(flow.metadata.entryPointPosition.x / gridSize) * gridSize
    flow.metadata.entryPointPosition.y = Math.round(flow.metadata.entryPointPosition.y / gridSize) * gridSize
    flow.modules.forEach(m => {
        m.metadata.position.x = Math.round(m.metadata.position.x / gridSize) * gridSize;
        m.metadata.position.y = Math.round(m.metadata.position.y / gridSize) * gridSize;
    });
    const pp = c => Math.round(c).toString().padStart(4, '0')
    const p = m => `${pp(m.metadata.position.x)},${pp(m.metadata.position.y)}`;
    flow.modules.sort((a, b) => p(a).localeCompare(p(b)));
    // Add in the metadata fields normally added by the connect UI.
    flow.metadata.status = data[0].contactFlowStatus;
    flow.metadata.name = name;
    flow.metadata.description = description;
    flow.metadata.type = contactFlowType;
    return flow;
};

const getFlowEditToken = async (instanceAlias, token, flowARN) => {
    const res = await fetch(`https://${instanceAlias}.awsapps.com/connect/contact-flows/edit?id=${flowARN}`, fetchAuth(token));
    const html = await res.text();
    match = html.match(/app\.constant\(\"token\", \"(.+)\"\)/);
    if (match === null) {
        throw new Error('Failed to get edit token');
    }
    return match[1];
};

const fixFlowARNs = (instanceAlias, token) => async (flowARN, flowJSON, { editToken, fixLambdaARNs=true, serverlessStage }={}) => {
    if (!token) {
        throw new Error('not logged in');
    }
    if (!editToken) {
        editToken = await getFlowEditToken(instanceAlias, token, flowARN);
    }
    const flow = JSON.parse(flowJSON);
    if (fixLambdaARNs) {
        const destAccount = flowARN.match(/arn:aws:connect:[^:]+:([^:]+):/)[1];
        flowJSON = flowJSON.replace(/arn:aws:lambda:[^:]+:([^:]+):function:([^:"]+)/g, (arn, account, name) => {
            arn = arn.replace(account, destAccount);
            const stage = name.match(/.+-([^\-]+)-[^\-]+$/)
            if (serverlessStage && stage !== null) {
                const newName = name.replace(`-${stage[1]}-`, `-${serverlessStage}-`)
                arn = arn.replace(name, newName)
            }
            return arn;
        });
    }
    const res = await fetch(`https://${instanceAlias}.awsapps.com/connect/contact-flows/import?contactFlowType=${flow.metadata.type}&token=${editToken}`, {
        method: 'POST',
        body: JSON.stringify({
            contactFlowType: flow.metadata.type,
            token: editToken,
            fileData: Buffer.from(flowJSON).toString('base64'),
        }),
        headers: {
            "content-type": "application/json;charset=UTF-8",
            ...fetchAuth(token).headers
        },
    });
    if (!res.headers.get('Content-Type').startsWith("application/json")) {
        throw new Error(`transform: html response`);
    }
    if (res.status >= 400) {
        throw new Error(`transform: status ${res.status}`)
    }
    const [body] = await res.json();
    if (body.errorType !== null) {
        throw new Error(body.errorDetails);
    }
    return body.contactFlowContent;
};

const fixFlowCerts = (flowJSON, encryptionId, encryptionCert) => {
    return flowJSON
        .replace(/EncryptionKeyId",\s?"value":\s?"([^"]+)"/, (all, key) => all.replace(key, encryptionId))
        .replace(/EncryptionKey",\s?"value":\s?"([^"]+)"/, (all, cert) => all.replace(cert, String(encryptionCert).replace(/\n/g, '\\n')));
};

const uploadFlow = (instanceAlias, token) => async (flowARN, flowJSON, { editToken, publish = false, fixARNs = true, fixLambdaARNs = true, serverlessStage, encryptionId, encryptionCert }={}) => {
    if (!token) {
        throw new Error('not logged in');
    }
    if (!editToken) {
        editToken = await getFlowEditToken(instanceAlias, token, flowARN);
    }
    if (fixARNs) {
        flowJSON = await fixFlowARNs(instanceAlias, token)(flowARN, flowJSON, { editToken, fixLambdaARNs, serverlessStage });
    }
    if (encryptionId && encryptionCert) {
        flowJSON = fixFlowCerts(flowJSON, encryptionId, encryptionCert);
    }
    const flow = JSON.parse(flowJSON);
    const [arn0, arnInstance, arn1, arnFlow] = flowARN.split('/');
    const res = await fetch(`https://${instanceAlias}.awsapps.com/connect/contact-flows/edit?token=${editToken}`, {
        method: 'POST',
        body: JSON.stringify({
            arn: flowARN,
            resourceArn: flowARN,
            resourceId: arnFlow,
            organization: `${arn0}/${arnInstance}`,
            organizationArn: `${arn0}/${arnInstance}`,
            organizationResourceId: arnInstance,
            contactFlowType: flow.metadata.type,
            contactFlowContent: flowJSON,
            contactFlowStatus: publish ? 'published' : 'saved',
            name: flow.metadata.name,
            description: flow.metadata.description,
            isDefault: false,
        }),
        headers: {
            "content-type": "application/json;charset=UTF-8",
            ...fetchAuth(token).headers
        },
    });
    if (!res.headers.get('Content-Type').startsWith("application/json")) {
        throw new Error(`upload: html response`);
    }
    if (res.status == 400) {
        const body = await res.json();
        throw new Error(`upload: status ${res.status}, ${body.map(e => `${e.moduleId}:${e.errorType}:${e.errorDetails}`).join(', ')}`)
    } else if (res.status > 400) {
        throw new Error(`upload: status ${res.status}`)
    }
};

module.exports = async (instanceAlias, { chromiumPath, username, password, instanceId }) => {
    const auth = await getAuthType(instanceAlias);
    let token;
    if (auth == AUTH_TYPE_FEDERATED) {
        token = await loginFederated(instanceId);
    } else {
        token = await loginForm(instanceAlias, username, password, { chromiumPath });
    }
    return {
        listFlows: listFlows(instanceAlias, token),
        getFlow: getFlow(instanceAlias, token),
        uploadFlow: uploadFlow(instanceAlias, token),
        fixFlowARNs: fixFlowARNs(instanceAlias, token),
    };
};

module.exports.AUTH_TYPE_FORM = AUTH_TYPE_FORM;
module.exports.AUTH_TYPE_FEDERATED = AUTH_TYPE_FEDERATED;
module.exports.getAuthType = getAuthType;
