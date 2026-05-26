const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('Via-Exam', 'postgres', 'postgres', {
  host: '13.233.244.159',
  dialect: 'postgres',
  logging: false,
});
async function fix() {
  try {
    await sequelize.query('DROP INDEX IF EXISTS uq_exam_teacher;');
    console.log('Index uq_exam_teacher dropped successfully.');
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
fix();
