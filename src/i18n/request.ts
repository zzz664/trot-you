import { getRequestConfig } from 'next-intl/server';
import { APP_LOCALE } from '@/config/constants';
import messages from '@/messages/ko.json';

export default getRequestConfig(async () => ({ locale: APP_LOCALE, messages }));
