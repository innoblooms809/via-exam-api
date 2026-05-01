import { model, Schema } from 'mongoose';


const HealthcheckSchema = new Schema({
   status: Number,
   msg: String

})

const HealthModal = model('HealthcheckSchema', HealthcheckSchema);
export default HealthModal;