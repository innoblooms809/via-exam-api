import "../config/config";
import { sequelize } from "../config/sequelize";
import { DataTypes } from "sequelize";

const main = async () => {
  const qi = sequelize.getQueryInterface();
  const table = await qi.describeTable("viaexam_exams");

  if (!table.examDate) {
    await qi.addColumn("viaexam_exams", "examDate", { type: DataTypes.DATEONLY, allowNull: true });
    console.log("Added examDate");
  } else {
    console.log("examDate already exists");
  }

  if (!table.examTime) {
    await qi.addColumn("viaexam_exams", "examTime", { type: DataTypes.TIME, allowNull: true });
    console.log("Added examTime");
  } else {
    console.log("examTime already exists");
  }

  const [indexes]: any = await sequelize.query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'viaexam_exams';`
  );
  const indexNames = indexes.map((i: any) => i.indexname);

  if (!indexNames.includes("viaexam_exams_exam_date_index")) {
    await qi.addIndex("viaexam_exams", ["examDate"], { name: "viaexam_exams_exam_date_index" });
    console.log("Added examDate index");
  } else {
    console.log("examDate index already exists");
  }

  if (!indexNames.includes("viaexam_exams_section_id_index")) {
    await qi.addIndex("viaexam_exams", ["sectionId", "instituteId"], { name: "viaexam_exams_section_id_index" });
    console.log("Added sectionId index");
  } else {
    console.log("sectionId index already exists");
  }

  console.log("Done.");
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
