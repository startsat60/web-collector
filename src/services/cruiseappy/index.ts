import { url } from "inspector";
import { launchBrowser } from "../../helpers/browser.js";
import { Credentials, sleep } from "../../helpers/lib.js";
import { createSpinner } from "nanospinner";

const loginUrl = process.env.CRUISEAPPY_LOGIN_URL;

export const doLogin = async (credentials: Credentials, page) => {
	page.goto(loginUrl, { timeout: 120000 });
	page.waitForNavigation();
	await sleep(5000);

	// Type into search box
	const usernameSelector = `[id='user_login']`;
	await page.waitForSelector(usernameSelector, { timeout: 10000 });
	await page.type(`[id='user_login']`, credentials.username, { delay: 10 });

	const passwordSelector = `[id='user_pass']`;
	await page.waitForSelector(passwordSelector, { timeout: 10000 });
	await page.type(`[id='user_pass']`, credentials.password, { delay: 10 });
	
	const loginButtonSelector = `[type='submit']`;
	await page.waitForSelector(loginButtonSelector, { timeout: 10000 });
	await page.click(loginButtonSelector);
};

export const runGetCruisesProcess = async ({
	credentials
}: {
	credentials: Credentials
}) => {
	const browser = await launchBrowser();
	const page = await browser.newPage();
	page.setViewport({ width: 1200, height: 800 });
	await doLogin(credentials, page);
	await page.waitForNavigation();

	const cruiseAppySelector = `[href*='edit.php?post_type=cruises']`;
	await page.waitForSelector(cruiseAppySelector, { timeout: 10000 });
	await page.click(cruiseAppySelector);
	await page.waitForSelector(`table.wp-list-table`, { timeout: 10000 });

	const cruiseItems = await page.evaluate(async () => {
		const cruiseRowSelector = `table.wp-list-table tbody tr`;
		const cruiseRows = Array.from(document.querySelectorAll(cruiseRowSelector));
		return cruiseRows.map((cruise, index) => {
			const cruiseTitle = cruise.querySelector(`td.column-title`);
			const cruiseLink = cruiseTitle.querySelector('a').href;
			return cruiseLink;
		});
	});
	await getCruises(browser, cruiseItems).then(async () => await browser.close());
};

export const getCruises = async (browser, urls: string[]) => {
	const cruiseData = await Promise.all(await urls.map(async (url: string, i: number) => {
		const cruisePage = await browser.newPage();
		await cruisePage.goto(url);
		cruisePage.waitForNavigation({ waitUntil: 'networkidle0' });
		const cruiseSpinner = createSpinner('Getting cruise data...').start();
		const cruise = await getCruise(cruisePage);
		cruiseSpinner.success({ text: `Getting cruise data...${cruise.title}...Done` });
		return cruise;
	}));
	return cruiseData;
};

export const getCruise = async (cruisePage: any) => {
	await cruisePage.waitForSelector(`[name=post_title]`, { timeout: 10000 });
	const cruiseData = await cruisePage.evaluate(async () => {
		const cruiseTitle = document.querySelector(`[name=post_title]`).textContent.trim();
		return {
			title: cruiseTitle
		}
	});
	return cruiseData;
};