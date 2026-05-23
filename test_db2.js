const { Sequelize } = require('sequelize');
const sequelize = new Sequelize('Via-Exam', 'postgres', 'postgres', {
  host: '13.233.244.159',
  dialect: 'postgres',
  logging: false,
});
async function check() {
  const result = await sequelize.query(`
    SELECT
      i.relname as index_name,
      a.attname as column_name
    FROM
      pg_class t,
      pg_class i,
      pg_index ix,
      pg_attribute a
    WHERE
      t.oid = ix.indrelid
      AND i.oid = ix.indexrelid
      AND a.attrelid = t.oid
      AND a.attnum = ANY(ix.indkey)
      AND t.relkind = 'r'
      AND t.relname = 'viaexam_question_papers'
      AND ix.indisunique = true;
  `);
  console.log(result[0]);
  process.exit(0);
}
check();
