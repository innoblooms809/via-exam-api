import httpStatus from "http-status";
import TeamMember from "../models/TeamMembers.model";
import Sequelize from "sequelize"; // Import the sequelize instance
import { Op } from "sequelize";
import UserModal from "../models/user.model";
import { IResponse } from "../types/response";

const getAllTeamList = async (): Promise<IResponse> => {
  try {
    const teams = await TeamMember.findAll();
    const teamLeadsMap = new Map();
    const result = [];

    // First, process all team members and group them under their respective team lead
    teams.forEach((member: any) => {
      if (member.role === "team_lead") {
        // If it's a team lead, store them in the map
        teamLeadsMap.set(member.userId, {
          teamLead: {
            id: member.id,
            userId: member.userId,
            userName: member.userName,
            userPhoto: member.userPhoto,
            designationName: member.designationName,
          },
          teamMembers: [], // Initialize an empty array for the team members
        });
      }
    });

    // Now group the team members
    teams.forEach((member: any) => {
      if (member.role === "team_member") {
        const lead = teamLeadsMap.get(member.teamLead_id);
        if (lead) {
          lead.teamMembers.push({
            id: member.id,
            userId: member.userId,
            userName: member.userName,
            userPhoto: member.userPhoto,
            designationName: member.designationName,
          });
        }
      }
    });
    result.push(...teamLeadsMap.values());
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: result,
      message: "Team member Details list is fetched.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const createTeamMembers = async (req: any): Promise<IResponse> => {
  try {
    const teamLead: any = await TeamMember.create({
      userId: req.teamLead.userId,
      userName: req.teamLead.userName,
      userPhoto: req.teamLead.userPhoto,
      designationName: req.teamLead.designationName,
      role: "team_lead",
    });
    const teamMembers = await TeamMember.bulkCreate(
      req.teamMembers.map((member: any) => ({
        userId: member.userId,
        userName: member.userName,
        userPhoto: member.userPhoto,
        designationName: member.designationName,
        teamLead_id: teamLead.userId, // Associate each team member with the team lead
        role: "team_member",
      }))
    );
    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: { teamLead, teamMembers },
      message: "New team member Details is created.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  createTeamMembers,
  getAllTeamList,
};
