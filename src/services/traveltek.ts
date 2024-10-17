import { createSpinner } from "nanospinner";
import { launchBrowser, timeout } from "../helpers/browser.js";
import 'dotenv/config';
import { dateAdd, formatDate, formatTime, sleep } from "../helpers/lib.js";
import chalk from "chalk";

const loginUrl = process.env.TRAVELTEK_BOOKINGS_URL;
const bearerToken = process.env.BEARER_TOKEN;
const apiUrlBase = process.env.API_URL_BASE;
const processingStartTime = process.env.DAILY_PROCESSING_START_TIME || '09:00';
const processingEndTime = process.env.DAILY_PROCESSING_END_TIME || '21:30';
const defaultSleepTimeInMs = process.env.DEFAULT_SLEEP_TIME_IN_MS ? 
	Number(process.env.DEFAULT_SLEEP_TIME_IN_MS) : 
	300000;

export interface Credentials {
	username: string;
	password: string;
};

export const processBookings = async (browser, bookingsData, showLogging = true, currentPage?) => {
	let processBookingsSpinner = null,
		bookingReferenceNumber = bookingsData[0].referenceNumber ?? bookingsData[0].url,
		loggingMessage = `Processing ${bookingsData.length} bookings starting with ${bookingReferenceNumber}...`,
		errors = [];

	if (showLogging) {
		processBookingsSpinner = createSpinner(loggingMessage).start();
	};

	await Promise.all(await bookingsData.map(async booking => {
		try {
			// const { referenceNumber } = booking;
			// console.log(`Getting booking data for ${referenceNumber}...`);	
			const bookingPage = await browser.newPage();
			await bookingPage.goto(booking.url, { timeout: 120000 });
	
			const bookingDetailsSelector = `table.detailstable > tbody > tr.detailsrow`;
			await bookingPage.waitForSelector(bookingDetailsSelector)
			.catch(async () => {
				errors.push(`${booking.referenceNumber ?? booking.url} - Booking details data exception. Not updating.`);
				await bookingPage.close();
			});
	
			const bookingData = await bookingPage.evaluate(async () => {
				const detailsTable = Array.from(document.querySelectorAll('table.detailstable > tbody > tr.detailsrow td'));
	
				const conversion_reference = detailsTable[1].textContent.trim();
				let bookingPayload = [], detail = null;
				
				bookingPayload.push({ label: 'traveltek_url', value: document.location.href });
	
				if (detailsTable.length > 0) {	
					for (let i=0; i < detailsTable.length; i++) {
						const isEven = i % 2 == 0;
						const child = detailsTable[i];
						if (isEven) {
							detail = {
								...detail,
								label: child.textContent.trim().toLowerCase().replace(/\s+/g, '_')
							};
							continue;
						};
				
						if (!detail.label.trim()) {
							detail = null;
							continue;
						};
						
						bookingPayload.push({
							...detail,
							value: child.textContent.trim()
						});
						detail = null;
					}
				}
	
				const elements = document.querySelector('#elementlist');
				const portfoliosElements = elements.querySelectorAll('.portfolioelement');
				const elementsData = [];
				portfoliosElements.forEach((portfoliosElement) => {
					const portfolio = portfoliosElement.querySelectorAll('.listtable tr td');
					const hiddenDetails = portfoliosElement.querySelectorAll('& > div table tr td');
	
					const element = [
						{ label: 'provider', value: portfolio[6].textContent.trim() },
						{ label: 'provider_reference', value: portfolio[7].textContent.trim() },
						{ label: 'type', value: portfolio[3].textContent.trim() },
						{ label: 'net', value: portfolio[9].textContent.trim() },
						{ label: 'gross', value: portfolio[10].textContent.trim(), },
						{ label: hiddenDetails[0].textContent.trim().toLowerCase().replace(/\s+/g, '_'), value: hiddenDetails[1].textContent.trim(), },
						{ label: hiddenDetails[2].textContent.trim().toLowerCase().replace(/\s+/g, '_'), value: hiddenDetails[3].textContent.trim(), },
					];
					elementsData.push(element.reduce((acc, { label, value }) => {
						acc[label] = value;
						return acc;
					}, {}));
				});
	
				bookingPayload = {
					...bookingPayload.reduce((acc, { label, value }) => {
						acc[label] = value;
						return acc;
					}, {}),
					...{ elements: elementsData }
				};
	
				//	All travellers
				const bookingPassengerListSelector = `#financial-details + h3 + .listtable .listrow`;
				const bookingPassengerList = document.querySelectorAll(bookingPassengerListSelector);
				const passengers = [];
				bookingPassengerList.forEach((passenger) => {
					const passengerName = passenger.querySelector(`td:nth-child(2)`).textContent.trim();
					const passengerFare = passenger.querySelector(`td:nth-child(4)`).textContent.trim();
					const passengerPhone = passenger.querySelector(`td:nth-child(6)`).textContent.trim();
					const passengerEmail = passenger.querySelector(`td:nth-child(8)`).textContent.trim();
	
					passengers.push({
						name: passengerName,
						fare: passengerFare,
						phone: passengerPhone,
						email: passengerEmail,
					});
				});
				bookingPayload['passengers'] = passengers;
	
				const payload = [
					{
						conversion_reference,
						additional_data: bookingPayload
					}
				];
				return payload;
			});
		
			//	Costings
			const costingsSelector = `[href*='costingbreakdown']`;
			await bookingPage.waitForSelector(costingsSelector);
			await bookingPage.click(costingsSelector);
			await bookingPage.waitForSelector(`[href*='bofinancial.pl?action=costing_add']`)
			.catch(async () => {
				errors.push(`${booking.referenceNumber ?? booking.url} - Costings data exception. Not updating.`);
				await bookingPage.close();
			});
			const costingsData = await bookingPage.evaluate(() => {
				const costingsElement = document.querySelectorAll(`.listtable #rtotalrow td`);
				return {
					nett: costingsElement[5].textContent.trim(),
					gross: costingsElement[6].textContent.trim(),
					apportioned: costingsElement[7].textContent.trim(),
					unapportioned: costingsElement[8].textContent.trim(),
					extra_margin: costingsElement[9].textContent.trim(),
					commission: costingsElement[10].textContent.trim(),
					gst: costingsElement[11].textContent.trim(),
				};
			});
			bookingData[0].additional_data['total_costings'] = costingsData;
	
			//	Receipts
			const receiptsSelector = `[href*='receipts']`;
			await bookingPage.waitForSelector(receiptsSelector);
			await bookingPage.click(receiptsSelector);
			await bookingPage.waitForSelector(`[href*='cardpayment.pl']`)
			.catch(async () => {
				errors.push(`${booking.referenceNumber ?? booking.url} - Receipts exception. Not updating.`);
				await bookingPage.close();
			});
			const receiptsData = await bookingPage.evaluate(() => {
				const receipts = [];
				const receiptTables = document.querySelectorAll(`.listtable`);
				if (receiptTables.length === 0) return receipts;
	
				//	Receipts
				const receiptsRows = receiptTables[0].querySelectorAll(`.listrow`);
				receiptsRows.forEach((receipt) => {
					receipts.push({
						id: receipt.querySelector(`td:nth-child(2)`).textContent.trim(),
						reference: receipt.querySelector(`td:nth-child(3)`).textContent.trim(),
						date: receipt.querySelector(`td:nth-child(4)`).textContent.trim(),
						payment_method: receipt.querySelector(`td:nth-child(5)`).textContent.trim(),
						total_value: receipt.querySelector(`td:nth-child(6)`).textContent.trim(),
						card_fee: receipt.querySelector(`td:nth-child(7)`).textContent.trim(),
						unapportioned_amount: receipt.querySelector(`td:nth-child(8)`).textContent.trim(),
						type: 'receipt',
					});
				});
				if (receiptTables.length === 1) return receipts;
	
				//	Refunds
				const refundRows = receiptTables[1].querySelectorAll(`.listrow`);
				refundRows.forEach((receipt) => {
					receipts.push({
						id: receipt.querySelector(`td:nth-child(1)`).textContent.trim(),
						reference: receipt.querySelector(`td:nth-child(3)`).textContent.trim(),
						date: receipt.querySelector(`td:nth-child(2)`).textContent.trim(),
						payment_method: receipt.querySelector(`td:nth-child(4)`).textContent.trim(),
						total_value: receipt.querySelector(`td:nth-child(7)`).textContent.trim(),
						card_fee: null,
						unapportioned_amount: null,
						type: 'refund',
					});
				});
				return receipts;
			});
			bookingData[0].additional_data['receipts'] = receiptsData ?? [];
	
			//	Primary Booking Passenger - this navigates to a new page so do all booking processing before this
			const passengerSelector = `[href*='customer_view']`;
			await bookingPage.waitForSelector(passengerSelector, { timeout: 10000 })
			.then(async () => {
				await bookingPage.click(passengerSelector);
				bookingData[0].additional_data['primary_passenger'] = await bookingPage.waitForSelector(`.boxstyle1`, { timeout: 5000 })
				.then(async () => {
					return await bookingPage.evaluate(() => {
						const passengerContactDetailsElement = document.querySelectorAll(`h3 + table td`);
						const passengerName = passengerContactDetailsElement[1].textContent.trim();
						const passengerEmail = passengerContactDetailsElement[41].textContent.trim();
						const passengerPhone = passengerContactDetailsElement[31].textContent.trim();
						const passengerDOB = passengerContactDetailsElement[9].textContent.trim();
						const passengerPostcode = passengerContactDetailsElement[29].textContent.trim();
			
						return {
							name: passengerName,
							email: passengerEmail,
							phone: passengerPhone,
							dob: passengerDOB,
							postcode: passengerPostcode,
						};
					});
				})
				.catch(async () => {
					errors.push(`${booking.referenceNumber ?? booking.url} - Customer data exception. Updating with default data.`);
					return {
						name: '',
						email: '',
						phone: '',
						dob: '',
						postcode: '',
					};
					// await bookingPage.close();
				});
			})
			.catch(async () => {
				errors.push(`${booking.referenceNumber ?? booking.url} - Customer data exception. Updating with default data.`);
				bookingData[0].additional_data['primary_passenger'] = {
					name: '',
					email: '',
					phone: '',
					dob: '',
					postcode: '',
				};
				// await bookingPage.close();
			});
	
			await fetch(apiUrlBase, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${bearerToken}`
				},
				body: JSON.stringify(bookingData)
			})
			.then((response) => response.json())
	
			await bookingPage.close();
			return {
				...bookingData,
				additional_data: {
					...bookingData['additional_data'],
				}
			};
		} catch (err) {
			await browser.currentPage && browser.currentPage.close();
		}
	}));

	if (errors.length > 0) {
		processBookingsSpinner && processBookingsSpinner.error({ text: `${loggingMessage}Error` });
		console.log(`${chalk.red(`${errors.join('\n')}`)}`);
		return;
	}
	processBookingsSpinner && processBookingsSpinner.success({ text: `${loggingMessage}Done` });
};

export const getBookings = async (browser, page) => {
	const nextPageSelector = `.pages > .selpage + .page a:last-of-type`;
	let hasNextPage = await page.$(nextPageSelector) !== null;
	let isFirstPage = await page.$eval('.pages > .selpage', el => el.textContent) === '1';

	while (hasNextPage || isFirstPage) {
		const currentPageBookingsData = await page.evaluate(() => {
			const rows = Array.from(document.querySelectorAll(`table.listtable > tbody > tr.listrow`));
			return rows.map(row => {
				const columns = row.querySelectorAll(`td[width='10%']`);
				const bookingReference = columns[0].textContent.trim();
				const bookingUrl = columns[1].querySelector(`a`).href;
				return {
					referenceNumber: bookingReference,
					url: bookingUrl.replace('&shownote=1', '')
				};
			});
		});

		await processBookings(browser, currentPageBookingsData);

		hasNextPage = await page.$(nextPageSelector) !== null;
		isFirstPage = false;
		if (hasNextPage) {
			await Promise.all([
				page.waitForNavigation({ waitUntil: 'networkidle0' }),
				page.click(nextPageSelector)
			]);
			// console.log('Navigating to next page...');
		}
	}
};

export const doLogin = async (credentials: Credentials, page) => {
	page.goto(loginUrl, { timeout: 120000 });

	// Type into search box
	const usernameSelector = `[name='username']`;
	await page.waitForSelector(usernameSelector);
	await page.type(`[name='username']`, credentials.username, { delay: 10 });

	const passwordSelector = `[name='password']`;
	await page.waitForSelector(passwordSelector);
	await page.type(`[name='password']`, credentials.password, { delay: 10 });
	
	const loginButtonSelector = `[type='submit']`;
	await page.waitForSelector(loginButtonSelector);
	await page.click(loginButtonSelector);
};

export const processLiveBookings = async (credentials, browser?, startDate?, endDate?) => {
	const reportStartDate = startDate ? new Date(startDate) : new Date();
	const reportEndDate = endDate ? new Date(endDate) : new Date();

	const reportStartDay = reportStartDate.getDate();
	const reportStartMonth = reportStartDate.getMonth()+1;
	const reportStartYear = reportStartDate.getFullYear();

	const reportEndDay = reportEndDate.getDate();
	const reportEndMonth = reportEndDate.getMonth()+1;
	const reportEndYear = reportEndDate.getFullYear();

	// Launch the browser and open a new blank page
	browser = browser ?? await launchBrowser();
	const page = await browser.newPage();

	try {
		await doLogin(credentials, page);

		await page.goto(`https://isell.traveltek.net/SAS/backoffice/boportfolios.pl?
			reference=&firstname=&lastname=&tradingnameid=&datetype=created&
			startdate-day=${reportStartDay}&startdate-month=${reportStartMonth}&startdate-year=${reportStartYear}&
			enddate-day=${reportEndDay}&enddate-month=${reportEndMonth}&enddate-year=${reportEndYear}&
			postcode=&telephone=&createdby=&branch=&bookinguser=&holidaymakerid=&
			externalref=&elementtype=&suppliername=&supplierref=&status=&promocode=&
			affiliate=&bookingteamid=&bookingbranchid=&customstatusid=&sourcecodeid=&
			cruisevoyagecode=&from=&action=&submit=Search+Portfolios`, { timeout: 120000 });

		const listBookingsSelector = `table.listtable > tbody > tr.listrow`;
		await page.waitForSelector(listBookingsSelector, { timeout: 5000 })
			.then(async () => await getBookings(browser, page))
			.catch((error) => console.error(`Timeout occurred showing search results. It usually means no bookings were returned. Err: ${error.message}`));
	} catch (error) {
		console.log(`${chalk.red(`General exception processing live bookings: ${error.message}`)}`);
	} finally {
		browser && await browser.close();
	}
};

export const doHistoricalBookings = async (credentials, historicalDataStartDate, historicalDataEndDate) => {
	// const fetchUrl = `${apiUrlBase}/search?booked_on_from=${historicalDataStartDate}&booked_on_to=${historicalDataEndDate}&departure_date_from=${new Date().toISOString().split('T')[0]}&booking_status=Changed&booking_status=Query&booking_status=Open&booking_status=Complete&booking_status=Cancelled&sort_by_order=created_date asc`;

	//	All bookings
	// const fetchUrl = `${apiUrlBase}/search?booked_on_from=${historicalDataStartDate}&booked_on_to=${historicalDataEndDate}&departure_date_from=${formatDate(new Date())}&sort_by_order=created_date asc`;

	//	Untravelled bookings
	// const fetchUrl = `${apiUrlBase}/search?departure_date_from=${formatDate(new Date())}&sort_by_order=created_date asc`;

	//	debugging
	const fetchUrl = `${apiUrlBase}/search?booked_on_from=${historicalDataStartDate}&booked_on_to=${historicalDataEndDate}&sort_by_order=created_date asc`;

	const existingBookings = await fetch(fetchUrl, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${bearerToken}`
		},
	})
	.then((response) => response.json())
	.then((response) => response.map(({ conversion_reference, traveltek_url }) => {
		return {
			referenceNumber: conversion_reference,
			url: traveltek_url
		}
	}));	

	if (existingBookings.length === 0) {
		console.log(`\nNo historical tasks between ${chalk.yellow(historicalDataStartDate)} and ${chalk.yellow(historicalDataEndDate)} to do. Exiting...`);
		process.exit();
	}

	const startTime = new Date();
	console.log(`\nChecking and updating historical data from ${chalk.yellow(historicalDataStartDate)} to ${chalk.yellow(historicalDataEndDate)} and it looks like there are ${existingBookings.length} records to get.\nThis takes a while so let's mark the start time as ${startTime.toLocaleTimeString()}.`);
	console.log(`Syncing ${existingBookings.length} historical bookings...`);
	let processBookingsSpinner = null;
	const chunkSize = 200;
	const bookingsPerChunk = 20;
	const chunks = [];

	for (let i = 0; i < existingBookings.length; i += chunkSize) {
		chunks.push(existingBookings.slice(i, i + chunkSize));
	}

	if (chunks.length > 1) {
		console.log(`That's quite a few bookings so they will be processed in ${chunks.length} chunks.`);
	}
	
	for await (const chunk of chunks) {
		//	launch a new browser and login for each chunk
		const browser = await launchBrowser();
		const page = await browser.newPage();
		await doLogin(credentials, page);

		try {		
			for (let i = 0; i < chunk.length; i += bookingsPerChunk) {
	
				const arrayOfPromises = [];
				for (let j = 0; j < bookingsPerChunk && i + j < chunk.length; j++) {
					arrayOfPromises.push(processBookings(browser, [chunk[i + j]], false));
				}

				const loggingMessage = `Syncing records ${i + 1} - ${i + arrayOfPromises.length} of next ${chunk.length} historical bookings starting at ${chunk[i]?.referenceNumber}...`;
				processBookingsSpinner = createSpinner(loggingMessage).start();

				await Promise.all(arrayOfPromises);
				processBookingsSpinner && processBookingsSpinner.success({ text: `${loggingMessage}Done` });
			}
		} catch (error) {
			processBookingsSpinner && processBookingsSpinner.error({ text: `Error: ${error.message}` });
		} finally {
			//	close browser between each chunk processing pass
			await browser.close();
			const sleepTimeoutMs = 5000;
			console.log(`${chalk.yellow(`Finished chunk processing. Sleeping for ${sleepTimeoutMs/1000} seconds before continuing...`)}`);
			sleep(sleepTimeoutMs);
		}
	};

	const endTime = new Date();
	console.log(`\nFinished checking and updating historical data. This processed bookings between ${chalk.yellow(historicalDataStartDate)} and ${chalk.yellow(historicalDataEndDate)} and took about ${parseInt(((endTime.getTime() - startTime.getTime())/1000/60).toString())} minutes.`);
};

const dailyProcessingCanStart = (processingStartTime) => (new Date() >= new Date(`${formatDate()} ${processingStartTime}`));
const dailyProcessingHasEnded = (processingEndTime) => (new Date() >= new Date(`${formatDate()} ${processingEndTime}`));
/**
 * Run the Traveltek daily booking routine.
 * This routine runs during the periods defined in the environment variables
 * @param credentials Traveltek credentials
 * @param historicalProcessHasExecuted Allows the historical process to be bypassed
 */
export const runDailyBookingProcessing = async (
	credentials,
	startDate,
	endDate,
	historicalProcessHasExecuted = false
) => {
	const daysAgoToProcessDaily = (0-Number(process.env.DAYS_AGO_TO_PROCESS_IN_DAILY_PROCESS)) || 0,
		daysToRun = process.env.DAILY_PROCESSING_DAYS_TO_RUN ? 
			process.env.DAILY_PROCESSING_DAYS_TO_RUN.split(',').map((d) => Number(d)) : [];
	let allProcessesAreHibernating = false;

	while (1 == 1) {
		const canStartDailyProcess = (dailyProcessingCanStart(processingStartTime)),// && daysToRun.includes(new Date().getDay())),
			hasDailyProcessEnded = dailyProcessingHasEnded(processingEndTime);

		if (canStartDailyProcess && !hasDailyProcessEnded) {
			const browser = await launchBrowser();
			try {
				await processLiveBookings(credentials, browser, startDate, endDate);
				await browser && browser.close();

				console.log(`\nDaily processing completed for ${startDate} to ${endDate}.`);
				const waitToProcessHistoryMessage = `Preparing to process bookings made in the last ${-1*daysAgoToProcessDaily} days...`;
				const waitToProcessHistory = createSpinner(waitToProcessHistoryMessage).start();
				//	Wait for a few seconds before running again because Traveltek API is slow
				await timeout(15000);
				waitToProcessHistory.success({ text: `${waitToProcessHistoryMessage}Done` });

				//	live update bookings made in the last n days
				await processLiveBookings(
					credentials,
					null,
					formatDate(dateAdd(new Date(), daysAgoToProcessDaily, 'days')), 
					formatDate(dateAdd(new Date(), -1, 'days'))
				);

				if (dailyProcessingHasEnded(processingEndTime)) {
					historicalProcessHasExecuted = false;
					console.log(`\nDaily processing end time has passed. Checking if historical processor should run next...`);
				} else {
					console.log(`Sleeping for ${defaultSleepTimeInMs/1000/60} minute(s) after processing bookings for ${startDate} to ${endDate}. Running again at ${formatTime(dateAdd(new Date(), (defaultSleepTimeInMs/1000/60), 'minutes'))}.\n`);
				}
			} catch (err) {
				console.log(`${chalk.red(`General exception occurred processing daily bookings: ${err.message}`)}`);
			} finally {
				browser && await browser.close();
				await timeout(defaultSleepTimeInMs);
			}
		} else {
			//	Only run historical bookings tasks outside the processing hours of the daily routine
			if (!historicalProcessHasExecuted && !allProcessesAreHibernating) {
				//	Check for historical bookings that need processing
				try {
					//	Only execute if the daily processing is hibernating and also 
					//		bypass this if the daily processing was skipped because it was executed outside 
					//		the processing hours
					await runHistoricalBookingProcessing(credentials);
					//	Turn if off after running once
					historicalProcessHasExecuted = true;
				} catch (err) {
					console.log(`${chalk.red(`General exception occurred processing historical bookings: ${err.message}`)}`);
				}
			} else {
				if (!allProcessesAreHibernating) {
					console.log(chalk.green(`\nHibernating bookings processing until ${processingStartTime}...`));
					allProcessesAreHibernating = true;	
				}
				await timeout(defaultSleepTimeInMs);
			}
		}
	}
};

export const runHistoricalBookingProcessing = async (credentials, startDate?, endDate?) => {
	const historyStartDate = startDate ?? 
		(process.env.HISTORICAL_PROCESSING_DAY_0 ? 
			formatDate(new Date(process.env.HISTORICAL_PROCESSING_DAY_0)) : 
			'2019-06-01'
		);	// Defaults back to day 1 or Traveltek data
	const historyEndDate = endDate ?? formatDate();

	await doHistoricalBookings(credentials, historyStartDate, historyEndDate);
	//	Let's allow some time to pass before trying again
	await timeout(10000);
};

export const runSpecificBookingProcessing = async (credentials, bookingUrls: string) => {
	const browser = await launchBrowser();
	const page = await browser.newPage();
	await doLogin(credentials, page);

	const bookingsData = bookingUrls.replace(/ /g, '').split(',').map(url => ({ url }));
	await processBookings(browser, bookingsData, true, page);
	browser && await browser.close();
}