import linkCheck from 'link-check';



export const checkWebsite = async (link) => {
    linkCheck('http://example.com', function (err, result) {
        if (err) {
            console.error(err);
            return;
        }
        console.log(`${result.link} is ${result.status}`);
    });   
}



console.log(checkWebsite('http://example.com'))