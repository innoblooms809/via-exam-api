import jwt from "jsonwebtoken";
import UserModel from "../models/user.model";
import config from "../config/config";
import { NextFunction, Request, Response } from "express";


const authenticate = async (req: any, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Authentication required" });
  }

  try {
    const decodedToken: any = jwt.verify(token, config.jwt.secret);
    const user = await UserModel.findOne({where:{userId:decodedToken?.sub.userId}});
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};

export default authenticate;
