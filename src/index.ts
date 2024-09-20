import puppeteer from 'puppeteer';

const url = `https://travelat60.site.traveltek.net/extranet/login.pl`;
(async () => {

	const processBookings = async (browser, bookingsData) => {
		const bookings = await Promise.all(await bookingsData.map(async booking => {
			const { referenceNumber } = booking;
			console.log(`Getting booking data for ${referenceNumber}...`);

			const bookingPage = await browser.newPage();
			await bookingPage.goto(booking.url, { timeout: 120000 });

			const bookingDetailsSelector = `table.detailstable > tbody > tr.detailsrow`;
			await bookingPage.waitForSelector(bookingDetailsSelector);

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
				portfoliosElements.forEach((portfoliosElement, index) => {
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

					// console.log('Each element', { elementsData });
				});

				bookingPayload = {
					...bookingPayload.reduce((acc, { label, value }) => {
						acc[label] = value;
						return acc;
					}, {}),
					...{ elements: elementsData }
				};
				// console.log({ data: portfolioData });
	
				//	All travellers
				const bookingPassengerListSelector = `#financial-details + h3 + .listtable .listrow`;
				const bookingPassengerList = document.querySelectorAll(bookingPassengerListSelector);
				const passengers = [];
				bookingPassengerList.forEach((passenger, index) => {
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
				// console.log(payload);
				return payload;//response;
			});
		
			//	Costings
			const costingsSelector = `[href*='costingbreakdown']`;
			await bookingPage.waitForSelector(costingsSelector);
			await bookingPage.click(costingsSelector);
			await bookingPage.waitForSelector(`[href*='bofinancial.pl?action=costing_add']`);
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
			// console.log({ costingsData });

			//	Primary Booking Passenger
			const passengerSelector = `[href*='customer_view']`;
			await bookingPage.waitForSelector(passengerSelector);
			await bookingPage.click(passengerSelector);
			await bookingPage.waitForSelector(`.boxstyle1`);

			const passengerData = await bookingPage.evaluate(() => {
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
			
			bookingData[0].additional_data['primary_passenger'] = passengerData;
			// console.log({ passengerData });

			const response = await fetch('https://api.startsat60.com/v2/holidays/conversions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					// 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIyNzMwOCwidXVpZCI6ImY0MWVlYmRkLWQ3YTAtNDEyNS04MjI3LTI0MzQ4NWZmZTM4NyIsImVtYWlsIjoic3RldmVuLndvb2xzdG9uQHN0YXJ0c2F0NjAuY29tIiwiaWF0IjoxNzEwMTM2MzY1LCJleHAiOjE3NDE2NzIzNjV9.nlVNZj9C7hEpcv-f5CXbLUvjdnhbS4K-f-WQrCWWwSw'
				},
				body: JSON.stringify(bookingData)
			})
			.then((response) => response.json());
	
			// console.log({
			// 	// 'API Response': response,
			// 	bookingData,
			// });

			await bookingPage.close();
			return {
				...bookingData,
				additional_data: {
					...bookingData['additional_data'],
					primary_passenger: passengerData 
				}
			};
		}));
	};

	const getBookings = async (browser, page) => {
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
				console.log('Navigating to next page...');
			}
		}
	};

	const launch = async (startDate?, endDate?) => {

		const reportStartDate = startDate ? new Date(startDate) : new Date();
		const reportEndDate = endDate ? new Date(endDate) : new Date();

		const reportStartDay = reportStartDate.getDate();
		const reportStartMonth = reportStartDate.getMonth()+1;
		const reportStartYear = reportStartDate.getFullYear();

		const reportEndDay = reportEndDate.getDate();
		const reportEndMonth = reportEndDate.getMonth()+1;
		const reportEndYear = reportEndDate.getFullYear();

		// Launch the browser and open a new blank page
		const browser = await puppeteer.launch({ headless: false });
		const page = await browser.newPage();

		try {
			// Navigate the page to a URL
			await page.goto(url, { timeout: 120000 });
	
			// Set screen size
			await page.setViewport({width: 1024, height: 768});
	
			// Type into search box
			const usernameSelector = `[name='username']`;
			await page.waitForSelector(usernameSelector);
			await page.type(`[name='username']`, `****`, { delay: 10 });
	
			const passwordSelector = `[name='password']`;
			await page.waitForSelector(passwordSelector);
			await page.type(`[name='password']`, `****`, { delay: 10 });
	
			const loginButtonSelector = `[type='submit']`;
			await page.waitForSelector(loginButtonSelector);
			await page.click(loginButtonSelector);
	
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
				.catch((error) => console.error(`No bookings exist for ${reportStartDate}`));	
		} catch (error) {
			console.error('Error: ', error);
		} finally {
			if (page) {
				await page.close();
			};
			await browser.close();
		}
	};
	
	const startDate = '2024-09-01';
	const numberOfDays = 11;
	const pauseBetweenIterations = 5000;
	for (let i = 0; i < numberOfDays; i++) {
		const reportStartDate = new Date(new Date(startDate).setDate(new Date(startDate).getDate() + i)).toISOString().split('T')[0];
		const reportEndDate = new Date(new Date(startDate).setDate(new Date(startDate).getDate() + i)).toISOString().split('T')[0];
		console.log(`\nProcessing report data for ${reportStartDate}...`);
		await launch(reportStartDate, reportEndDate);
		console.log(`\nPhew! Catching my breath for ${pauseBetweenIterations/1000} seconds...`);

		await new Promise(resolve => setTimeout(resolve, pauseBetweenIterations));
	}

})();