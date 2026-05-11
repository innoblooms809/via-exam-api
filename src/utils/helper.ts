import { v4 as uuidv4 } from "uuid";
const generatePassword = async () => {
    const randomNum = Math.floor(Math.random() * 10000);
    const prefix = 'RSP';
    const timestamp = Date.now().toString().slice(-6);
    const randomNumStr = randomNum.toString().padStart(4, '0'); 

    const id = prefix + timestamp + randomNumStr;

    return id.length === 10 ? id : id.slice(0, 10);
};

const generateUserId = async () => {
    const randomNum = Math.floor(Math.random() * 10000);
    const prefix = 'IB';
    const timestamp = Date.now().toString().slice(-4);
    const randomNumStr = randomNum.toString().padStart(4, '0');

    const id = prefix + timestamp + randomNumStr;
    return id.length === 8 ? id : id.slice(0, 8);
};

const generateCustomerId = async(name: string, ) => {
    const uuid = uuidv4().replace(/-/g, '');
    const p1 = name[0].toUpperCase();
    const p2 = name[name.length-1].toUpperCase();
    const customerId = `${p1}${p2}${uuid}`.slice(0, 12);
    return customerId.toUpperCase();
};

const generateEnquiryId = async(productName: string, productCategory: string) => {
    const uuid = uuidv4().replace(/-/g, '')
    const p1 = productName.toUpperCase().slice(0, 2);
    const p2 = productCategory.toUpperCase().slice(0, 2);
    const id = `${p1}-${p2}-${uuid}`.slice(0, 14);
    return id.toUpperCase();
};
export default { generatePassword ,generateUserId, generateCustomerId, generateEnquiryId};
