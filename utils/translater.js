import { translate } from '@vitalets/google-translate-api';


const text = 'irrigation';
const language = 'el';

const { query } =  await translate(text, { to: language });

console.log(query);