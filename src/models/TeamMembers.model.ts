import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/sequelize';
import UserModal from './user.model';  

const TeamMember = sequelize.define('TeamMember', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  userId: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true, 
  },
  userName: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  userPhoto: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  designationName: {
    type: DataTypes.STRING(100),
    allowNull: true,
  },
  role: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  teamLead_id: {
    type: DataTypes.STRING(50),
    allowNull: true,
    references: {
      model: UserModal,  // Reference the UserModal model
      key: 'userId',  // Reference userId which is STRING
    },
    onDelete: 'SET NULL',
  }
}, {
  tableName: 'team_members',
  timestamps: true,
});
// TeamMember.belongsTo(TeamMember, { foreignKey: 'teamLead_id', as: 'teamLead' }); 
// TeamMember.belongsTo(UserModal, { foreignKey: 'userId', as: 'user' }); 

export default TeamMember;
