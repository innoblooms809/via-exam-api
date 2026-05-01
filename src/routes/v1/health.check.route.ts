import express from 'express';
import { healthCheckController } from '../../controllers';
const router = express.Router();
router.route('/').get(healthCheckController.healthCheck);

export default router;
