const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const UserAgent = require('user-agents');

async function startBot(jobRole, jobLocation, limit) {
    const currentTime = Date.now();
    const userAgent = new UserAgent({ deviceCategory: 'desktop' });
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

    chromium.setGraphicsMode = false;

    let browser;

    try {
        const executablePath = isLambda
            ? await chromium.executablePath()
            : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath,
            headless: chromium,
        });

        const page = await browser.newPage();

        // // Setup stealth
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = { runtime: {} };
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) =>
                parameters.name === 'notifications'
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters);
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        });

        await page.setUserAgent(userAgent.toString());
        console.log("User-Agent:", userAgent.toString());

        try {
            await page.goto('https://www.glassdoor.co.in/Job/index.htm', {
                waitUntil: 'networkidle2',
                timeout: 0
            });
        } catch (err) {
            console.error("❌ Error navigating to GlassDoor:", err);
            throw err;
        }

        try {
            await page.waitForSelector('#searchBar-jobTitle', { visible: true, timeout: 10000 });
            await page.waitForSelector('#searchBar-location', { visible: true, timeout: 10000 });

            await page.click('#searchBar-jobTitle');
            await page.type('#searchBar-jobTitle', `${jobRole}`, { delay: 100 });

            await page.click('#searchBar-location');
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.type('#searchBar-location', `${jobLocation}`, { delay: 100 });

            await page.keyboard.press('Enter');
            await page.waitForNavigation({ waitUntil: 'networkidle2' });
        } catch (err) {
            console.error("❌ Error filling form fields:", err);
            throw err;
        }

        await page.waitForSelector('ul[aria-label="Jobs List"]');
        const jobCards = await page.$$('ul[aria-label="Jobs List"] > li');
        const jobs = [];

        for (let i = 0; i < Math.min(limit, jobCards.length); i++) {
            const jobCard = jobCards[i];
            const sleep = ms => new Promise(res => setTimeout(res, ms));

            //click on each cards
            await jobCard.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
            await jobCard.click();
            await sleep(Math.random() * 500); // jitter: 0 to 500ms

            // Wait for description panel to update
            try {
                const title = await jobCard.$eval('[data-test="job-title"]', el => el.innerText.trim());
                const company = await jobCard.$eval('.EmployerProfile_compactEmployerName__9MGcV', el => el.innerText.trim());
                const location = await jobCard.$eval('[data-test="emp-location"]', el => el.innerText.trim());
                const salary = await jobCard.$eval('[data-test="detailSalary"]', el => el.innerText.trim()).catch(() => '');
                const snippet = await jobCard.$eval('.JobCard_jobDescriptionSnippet__l1tnl', el => el.innerText.trim()).catch(() => '');
                const link = await jobCard.$eval('[data-test="job-title"]', el => el.href);

                // Extract job description from the right panel
                await page.waitForSelector(".JobDetails_jobDescription__uW_fK");
                const rawDescription = await page.$eval(
                    '.JobDetails_jobDescription__uW_fK',
                    el => el.innerHTML
                );

                const job = { title, company, location, salary, snippet, link, rawDescription };
                console.log(`✅ Extracted job ${i + 1}: ${title}`);
                jobs.push(job);
            } catch (err) {
                console.warn(`⚠️ Failed to extract job ${i + 1}:`, err.message);
            }
        }
        browser.close();
        const duration = Date.now() - currentTime;
        const seconds = Math.floor((duration / 1000) % 60);
        const minutes = Math.floor(duration / 1000 / 60);
        console.log(`⏱️ Process took ${minutes} minute(s) and ${seconds} second(s)`);
        return jobs;

    } catch (error) {
        console.error("❌ Critical error in startBot:", error);
        await browser.close();
        throw error; // important for Lambda to fail so Step Function retries
    }
}

module.exports = startBot;


