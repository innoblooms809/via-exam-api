const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('Via-Exam', 'postgres', 'postgres', {
  host: '13.233.244.159',
  dialect: 'postgres',
  logging: false,
});
async function check() {
  const result = await sequelize.query(`
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'viaexam_question_papers'::regclass
      AND contype = 'u';
  `);
  console.log(result[0]);
  process.exit(0);
}
check();
