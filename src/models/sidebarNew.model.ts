import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
class SidebarNew extends Model {}

// Initialize the SidebarNew model with the corresponding schema
SidebarNew.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      primaryKey: true,
      autoIncrement: true, // Automatically incrementing ID
    },
    kind: {
      type: DataTypes.ENUM("header", "divider", "segment", "children"),
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("children", "segment"),
      allowNull: true,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    icon: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    segment: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        // Only allow segment value if kind is 'segment'
        isSegment(value: any) {
          if (this.kind === "segment" && !value) {
            console.log(111);
            throw new Error("Segment is required when kind is 'segment'");
          }
        },
      },
    },
    moduleName:{
      type: DataTypes.STRING,
      allowNull: true,
    }
    // Create a relation with children if necessary
  },
  {
    sequelize,
    modelName: "SidebarNew",
    timestamps: true, // Automatically create createdAt and updatedAt fields
    tableName: "sidebars", // Custom table name
  }
);

// Defining the relationship for children (self-referencing)
SidebarNew.hasMany(SidebarNew, { foreignKey: "parentId", as: "children" });
SidebarNew.belongsTo(SidebarNew, { foreignKey: "parentId", as: "parent" });

export default SidebarNew;
