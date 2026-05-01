// const MongoClient = require('mongodb').MongoClient;
// const connectionString = process.env.ATLAS_URI || '';

// let clientPromise: Promise<any> = new Promise((re, rej) => {
//   MongoClient.connect(connectionString)
//     .then((mongodb: any) => {
//       re(mongodb.db('test'));
//     })
//     .catch((error: any) => {
//       rej(`Error ${error?.stack}`);
//     });
// });

// export default clientPromise;
