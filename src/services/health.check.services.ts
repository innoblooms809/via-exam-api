import { IResponse } from "../types/response";

/**
 * Healyh Check
 */
const HealthCheck = async (logData: any): Promise<IResponse> => {
  try {
    let respose = {
        error: false,
        statusCode: 200,
        message: `Server Up and Running`
      };
    return respose;
  } catch (e: any) {
    
    return {
      error: true,
      statusCode: 500,
      message: e?.stack
    };
  }
};


export default { HealthCheck };
