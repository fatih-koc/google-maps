import { parsePhoneNumber, findPhoneNumbersInText } from 'libphonenumber-js'


export function parseTextforPhoneNumber(text, country) {
    const possible_phones = findPhoneNumbersInText(text, country)

    //   const possible_phone = JSON.stringify(possible_phones[0]);

    if ((possible_phones == 0)) {
        return '';

    } else {
        // const possible_phone =  possible_phones[0].number.number ;
        return possible_phones[0].number.number;
    }
}
