import httpStatus from "http-status";
import DynamicHeading from "../models/DynamicHeading.model";
import DynamicModule from "../models/DynamicModule.model";
import DynamicField from "../models/DynamicField.model";
import SidebarNew from "../models/sidebarNew.model";
import { sequelize } from "../config/sequelize";
import {
  addColumn,
  dropColumn,
  renameColumn,
} from "../utils/dynamicColumn";
import { IResponse } from "../types/response";

const DTypeString: string[] = [
  "text",
  "date",
  "radio",
  "select",
  "email",
  "tele",
];
const DTypeInt: string[] = ["number"];
const DTypeBoolean: string[] = ["check"];

const getOneModule = async (moduleId: number): Promise<IResponse> => {
  try {
    const module: any = await DynamicModule.findOne({
      where: { id: moduleId },
      include: [
        {
          model: DynamicHeading,
          as: "headings",
          attributes: ["id", "heading", "moduleId", "order"],
        },
        {
          model: DynamicField,
          as: "fields",
          // attributes: ["id", "order"],
          order: [["order", "ASC"]],
        },
      ],
      order: [
        // ['id', 'ASC'],
        [{ model: DynamicField, as: "fields" }, "order", "ASC"],
      ],
    });
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: module,
      message: "Module Details list is fetched.",
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

const createDynamicModule = async (req: any): Promise<IResponse> => {
  try {
    const { id, moduleName, icon, no, deleted, headings, fields } = req;
    if (id) {
      const headingPromises = headings.map((heading: any) =>
        DynamicHeading.update(
          { heading: heading.heading, moduleId: id },
          {
            where: {
              moduleId: Number(id),
            },
          }
          // moduleId: module.id, // Associate heading with the module
          // heading: heading.heading,
        )
      );

      const response = await Promise.all(headingPromises);
      const fieldPromises = fields.map((field: any) => {
        const headingId = field.belongToSubTitle;
        return DynamicField.update(
          {
            // moduleId: module.id,
            label: field.label,
            name: field.name,
            type: field.type,
            belongToSubTitle: headingId,
            editable: field.editable,
            delete: field.delete,
            fixed: field.fixed,
            isTableField: field.isTableField,
            isView: field.isView,
            belongToMaster: field.belongToMaster,
            selectMaster: field.selectMaster,
            options: field.options,
            validation: field.validation, // Options stored directly in the field
            isisValidate: field.isValidate,
          },
          {
            where: {
              moduleId: id,
            },
          }
        );
      });

      await Promise.all(fieldPromises);
      return {
        error: false,
        statusCode: httpStatus.CREATED,
        data: { response },
        message: "New team member Details is created.",
      };
    } else {
      const duplicate = await DynamicModule.findOne({
        where: {
          moduleName: moduleName,
        },
      });
      console.log(duplicate);
      if (duplicate) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          data: {},
          message: "Module name already in used.",
        };
      }
      const moduleNames = moduleName.split(" ");
      const slug =
        moduleNames.length > 1
          ? moduleNames.join("-").toLowerCase()
          : moduleNames[0].toLowerCase();
      const module = await DynamicModule.create({
        moduleName,
        slug,
        icon,
        no,
        deleted,
      });

      const addSidebarModule = await SidebarNew.create({
        kind: "segment",
        title: moduleName,
        icon: icon,
        segment: `admin/${slug}`,
        moduleName: moduleName,
      });
      const Model = sequelize.define(
        slug,
        {},
        {
          tableName: slug,
          timestamps: true,
        }
      );

      Promise.all([module, addSidebarModule]);
      await Model.sync({ force: false });
      // const headingPromises = headings.map((heading: any) =>
      //   DynamicHeading.create({
      //     moduleId: module.id, // Associate heading with the module
      //     heading: heading.heading,
      //   })
      // );

      // await Promise.all(headingPromises);

      // const fieldPromises = fields.map((field: any) => {
      //   const headingId = field.belongToSubTitle || null;

      //   return DynamicField.create({
      //     moduleId: module.id,
      //     label: field.label,
      //     name: field.name,
      //     type: field.type,
      //     belongToSubTitle: headingId,
      //     editable: field.editable,
      //     delete: field.delete,
      //     fixed: field.fixed,
      //     isTableField: field.isTableField,
      //     isView: field.isView,
      //     belongToMaster: field.belongToMaster,
      //     selectMaster: field.selectMaster,
      //     options:
      //       field.options && field.options.length > 0 ? field.options : [], // Options stored directly in the field
      //     validation:
      //       field.validation && field.validation.length > 0
      //         ? field.validation
      //         : [],
      //     isValidate: field.isValidate,
      //   });
      // });

      // await Promise.all(fieldPromises);

      // Step 1: Create Module
      // console.log(2);
      return {
        error: false,
        statusCode: httpStatus.CREATED,
        data: { module, sidebar: addSidebarModule },
        message: "New team member Details is created.",
      };
    }
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

const updateDynamicModule = async (id: number, req: any): Promise<IResponse> => {
  try {
    console.log(req);
    const moduleNames = req?.moduleName.split(" ");
    const slug =
      moduleNames.length > 1
        ? moduleNames.join("-").toLowerCase()
        : moduleNames[0].toLowerCase();
    const module = await DynamicModule.findOne({
      where: {
        id: id,
      },
    });
    const updateModule = await DynamicModule.update(
      { moduleName: req?.moduleName, icon: req?.icon, slug: slug, no: 1 },
      {
        where: {
          id: id,
        },
      }
    );
    const updateSidebar = await SidebarNew.update(
      {
        title: req?.moduleName,
        icon: req?.icon,
        segment: `admin/${slug}`,
        moduleName: req?.moduleName,
      },
      {
        where: {
          moduleName: module?.moduleName,
        },
      }
    );
    const updatedSidebar = await SidebarNew.findOne({
      where: {
        moduleName: req?.moduleName,
      },
    });
    Promise.all([updateModule, updateSidebar, updatedSidebar]);
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: { updatedSidebar },
      message: "Headings updated or created successfully.",
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

const deleteDynamicModule = async (id: number): Promise<IResponse> => {
  try {
    const module = await DynamicModule.findOne({
      where: {
        id: id,
      },
    });

    const deleteSidebar = await SidebarNew.destroy({
      where: {
        moduleName: module?.moduleName,
      },
    });
    const deleteModule = await DynamicModule.destroy({
      where: {
        id: id,
      },
    });
    Promise.all([deleteModule, deleteSidebar]);
    const allSidebars = await SidebarNew.findAll();

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: { allSidebars },
      message: "Module deleted successfully.",
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

const updateDynamicHeading = async (id: number, req: any): Promise<IResponse> => {
  try {
    const { headings, fields } = req;

    // First, handle updating the existing heading data
    // const updatePromises = headings.map(async (heading: any, index: number) => {
    //   const [updatedCount] = await DynamicHeading.update(
    //     { heading: heading.heading, moduleId: id, order: index + 1 }, // New values for the existing row
    //     {
    //       where: {
    //         moduleId: id,
    //         id: heading.id,
    //       },
    //     }
    //   );
    //   // If no rows were updated, that means the row with the given id doesn't exist, so create a new one
    //   // if (updatedCount === 0) {
    //   //   await DynamicHeading.create({
    //   //     heading: heading.heading,
    //   //     moduleId: id,
    //   //     // id: heading.id, // Create a new record
    //   //   });
    //   // }
    // });

    // Handle the creation of new heading data
    const createPromises = headings.map(async (heading: any, index: number) => {
      console.log(heading, "hhhhhhhhhhhh");
      const existingHeading = await DynamicHeading.findOne({
        where: {
          moduleId: id,
          id: heading.id,
        },
      });

      // Only create new heading data if it doesn't exist in the table already
      if (!existingHeading) {
        console.log(heading, "dfffffff");
        await DynamicHeading.create({
          heading: heading.heading,
          moduleId: id,
          order: index + 1,
          // id: heading.id,  // Make sure to pass 'id' or let DB handle if it's an auto-incremented field
        });
      } else {
        await DynamicHeading.update(
          { heading: heading.heading, moduleId: id, order: index + 1 }, // New values for the existing row
          {
            where: {
              moduleId: id,
              id: heading.id,
            },
          }
        );
      }
    });

    // Wait for both update and create promises to finish
    await Promise.all([...createPromises]);

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Headings updated or created successfully.",
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

const updateDynamicField = async (id: number, req: any): Promise<IResponse> => {
  try {
    const { fields } = req;
    console.log(req);
    const module: any = await DynamicModule.findOne({
      where: {
        id: id,
      },
    });
    const createPromises = fields.map(async (field: any, index: number) => {
      // console.log(field)
      const existingField: any = await DynamicField.findOne({
        where: {
          moduleId: id,
          id: field.id,
        },
      });
      console.log(existingField);
      // Only create new heading data if it doesn't exist in the table already
      if (!existingField) {
        console.log(11);
        await DynamicField.create({
          moduleId: id,
          label: field.label,
          name: field.name,
          type: field.type,
          belongToSubTitle: field.belongToSubTitle,
          editable: field.editable,
          delete: field.delete,
          fixed: field.fixed,
          isTableField: field.isTableField,
          isView: field.isView,
          belongToMaster: field.belongToMaster,
          selectMaster: field.selectMaster,
          options:
            field.options && field.options.length > 0 ? field.options : [], // Options stored directly in the field
          validation:
            field.validation && field.validation.length > 0
              ? field.validation
              : [],
          isisValidate: field.isValidate,
          order: index + 1,
          // id: heading.id,  // Make sure to pass 'id' or let DB handle if it's an auto-incremented field
        });
        if (!req?.requestType && req?.requestType != "drag") {
          const type: string = DTypeString.includes(field?.type)
            ? "STRING"
            : DTypeInt.includes(field?.type)
            ? "INTEGER"
            : DTypeBoolean.includes(field?.type)
            ? "BOOLEAN"
            : "STRING";
          try {
            const modelSync = await addColumn(
              sequelize,
              module?.slug,
              field?.name,
              type,
              !field?.isValidate
            );
            if (modelSync) {
              console.log("Model synced successfully.");
            }
          } catch (error) {
            throw error;
          }
        }
      } else {
        console.log(122);
        await DynamicField.update(
          {
            // moduleId: module.id,
            label: field.label,
            name: field.name,
            type: field.type,
            belongToSubTitle: field.belongToSubTitle,
            editable: field.editable,
            delete: field.delete,
            fixed: field.fixed,
            isTableField: field.isTableField,
            isView: field.isView,
            belongToMaster: field.belongToMaster,
            selectMaster: field.selectMaster,
            options:
              field.options && field.options.length > 0 ? field.options : [], // Options stored directly in the field
            validation:
              field.validation && field.validation.length > 0
                ? field.validation
                : [],
            isValidate: field.isValidate,
            order: index + 1,
          }, // New values for the existing row
          {
            where: {
              moduleId: id,
              id: field.id,
            },
          }
        );
      }
    });

    // Wait for both update and create promises to finish
    await Promise.all([...createPromises]);

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: {},
      message: "Fields updated or created successfully.",
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

const getAllModule = async (): Promise<IResponse> => {
  try {
    const module = await DynamicModule.findAll({
      attributes: ["id", "moduleName", "slug", "icon", "no", "deleted"],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: module,
      message: "Module Details list is fetched.",
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

const getModuleBySlug = async (slug: string): Promise<IResponse> => {
  try {
    const module = await DynamicModule.findOne({
      where: {
        slug: slug,
      },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: module,
      message: "Module Details list is fetched.",
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

const updateOneField = async (
  moduleId: number,
  fieldId: number,
  req: any
): Promise<IResponse> => {
  try {
    let update;
    const module: any = await DynamicModule.findOne({
      where: { id: moduleId },
    });
    const updateField: any = await DynamicField.findOne({
      where: { moduleId: moduleId, id: fieldId },
    });
    if (updateField) {
      update = await DynamicField.update(
        { ...req },
        {
          where: {
            moduleId: moduleId,
            id: fieldId,
          },
        }
      );
    }
    const type: string = DTypeString.includes(req?.type)
      ? "STRING"
      : DTypeInt.includes(req?.type)
      ? "INTEGER"
      : DTypeBoolean.includes(req?.type)
      ? "BOOLEAN"
      : "STRING";
    // const newAttributes = {
    //   type: DataTypes[type],  // Use DataTypes to specify the new type
    //   allowNull: allowNull ?? true,   // Default to true if not specified
    // };
    // await changeColumn(
    //   sequelize,
    //   module?.slug,
    //   updateField.name,
    //   type,
    //   !req?.isValidate
    // );
    if(updateField.name != req?.name){
      await renameColumn(sequelize, module?.slug, updateField.name, req?.name)
    }
    
    // Wait for both update and create promises to finish
    const resolved = await Promise.all([update]);

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: resolved,
      message: "Fields updated successfully.",
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

const updateOneHeading = async (
  moduleId: number,
  headingId: number,
  req: any
): Promise<IResponse> => {
  try {
    let update;
    const updateField = await DynamicHeading.findOne({
      where: { moduleId: moduleId, id: headingId },
    });
    if (updateField) {
      update = await DynamicHeading.update(
        { ...req },
        {
          where: {
            moduleId: moduleId,
            id: headingId,
          },
        }
      );
    }

    // Wait for both update and create promises to finish
    const resolved = await Promise.all([update]);

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: resolved,
      message: "Heading updated successfully.",
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

const deleteField = async (moduleId: number, fieldId: number): Promise<IResponse> => {
  try {
    const field: any = await DynamicField.findOne({
      where: { moduleId: moduleId, id: fieldId },
    });

    if (!field) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        data: {},
        message: "Fields does not exist.",
      };
    }
    const module: any = await DynamicModule.findOne({
      where: { id: moduleId },
    });
    await dropColumn(sequelize, module?.slug, field?.name);

    const deleteField = await DynamicField.destroy({
      where: { moduleId: moduleId, id: fieldId },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: deleteField,
      message: "Fields deleted successfully.",
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

const deleteHeading = async (
  moduleId: number,
  headingId: number
): Promise<IResponse> => {
  try {
    const updateField = await DynamicHeading.findOne({
      where: { moduleId: moduleId, id: headingId },
    });
    if (!updateField) {
    }
    const deleteField = await DynamicHeading.destroy({
      where: { moduleId: moduleId, id: headingId },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: deleteField,
      message: "Headings deleted successfully.",
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
  createDynamicModule,
  getOneModule,
  updateDynamicHeading,
  updateDynamicField,
  getAllModule,
  updateOneField,
  deleteField,
  updateOneHeading,
  deleteHeading,
  updateDynamicModule,
  deleteDynamicModule,
  getModuleBySlug,
};
