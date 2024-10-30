import puppeteer from "puppeteer";

export const launchBrowser = async (runHeadless = Boolean(process.env.PUPPETEER_HEADLESS)) => {
	const browser = await puppeteer.launch({
		headless: runHeadless,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1920,1080'],
	});
	return browser;
}

export const timeout = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));