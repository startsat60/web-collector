import { authApi } from "./api";

export const updateBookingConversion = ({
	payload,
}: any) => 
	authApi.post(`v2/holidays/conversions`, payload);
