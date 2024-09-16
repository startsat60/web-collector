import axios from "axios";

const baseURL = `https://api-staging.startsat60.com`;

export const api = axios.create({
  baseURL,
});

export const authApi = axios.create({
  baseURL,
	withCredentials: true,
});

authApi.interceptors.request.use(
  async config => {
    const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MTIyNzMwOCwidXVpZCI6ImY0MWVlYmRkLWQ3YTAtNDEyNS04MjI3LTI0MzQ4NWZmZTM4NyIsImVtYWlsIjoic3RldmVuLndvb2xzdG9uQHN0YXJ0c2F0NjAuY29tIiwiaWF0IjoxNzEwMTM2MzY1LCJleHAiOjE3NDE2NzIzNjV9.nlVNZj9C7hEpcv-f5CXbLUvjdnhbS4K-f-WQrCWWwSw`;
    config.headers.Authorization = token;
    return config;
  },
  error => {
    return Promise.reject(error);
  }
);
