const generatePassword = async (): Promise<string> => {
  const randomNum = Math.floor(Math.random() * 10000);
  const prefix = "RSP";
  const timestamp = Date.now().toString().slice(-6);
  const randomNumStr = randomNum.toString().padStart(4, "0");

  const id = prefix + timestamp + randomNumStr;

  return id.length === 10 ? id : id.slice(0, 10);
};

const generateUserId = async (): Promise<string> => {
  const randomNum = Math.floor(Math.random() * 10000);
  const prefix = "IB";
  const timestamp = Date.now().toString().slice(-4);
  const randomNumStr = randomNum.toString().padStart(4, "0");

  const id = prefix + timestamp + randomNumStr;
  return id.length === 8 ? id : id.slice(0, 8);
};

export default { generatePassword, generateUserId };
