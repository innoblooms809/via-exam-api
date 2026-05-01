import httpStatus from "http-status";
import Master from "../models/MDM_Master.model";
import { Request, Response } from "express";
import { Op } from "sequelize";// Assuming the Master model is correctly defined

const getmaster = async (req: Request, res: Response) => {
  try {
    const { masterIds, code } = req.params;

    console.log(masterIds, code, "idddd");

    let masters: any;

    if (masterIds === "all") {
      // If masterIds is "all", fetch all masters
      masters = await Master.findAll({
        attributes:["masterId", "masterName"]
      });
    } else {
      const masterIdArray = masterIds.split(",").map((id) => Number(id.trim()));

      if (code) {
        // If code is provided, filter by both masterId and unitCode inside the data array
        masters = await Master.findAll({
          where: {
            masterId: {
              [Op.in]: masterIdArray, // Using Op.in to filter masterIds
            },
          },
          include: [
            {
              model: Master, // Assuming the model for the data array is called DataModel
              where: { unitCode: code }, // Filtering the data array by unitCode
              required: false, // Optional join
            },
          ],
        });

        // Now, we have filtered masters with the corresponding data by unitCode
        // Sequelize automatically filters data based on the provided code in the `include` statement
      } else {
        // If no code is provided, just filter by masterId
        masters = await Master.findAll({
          where: {
            masterId: {
              [Op.in]: masterIdArray, // Filter by masterIds
            },
          },
        });
      }
    }

    // Check if any masters were found
    if (!masters || masters.length === 0) {
      return res.status(404).send({
        error: true,
        statusCode: 404,
        data: masters,
        message: "Masters data not found",
      });
    }

    // Send the response with fetched masters data
    res.status(200).send({
      error: false,
      statusCode: 200,
      data: masters,
      message: "Masters data fetched successfully",
    });
  } catch (error) {
    console.error("Error fetching masters:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const createMaster = async (req: Request, res: Response) => {
  try {
    const newMaster = new Master(req.body); 
    // console.log(newMaster)// Ensure req.body matches MasterDocument structure
    const savedMaster = await newMaster.save();
    res.status(201).json(savedMaster);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error creating master entry", error });
  }
};
export default {
  getmaster,
  createMaster,
};
