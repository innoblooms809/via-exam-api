import connectDB from "../db/connect";
import AcademicCalendar from "../modals/AcademicCalendar.modal";

const run = async () => {
  try {
    const res = await AcademicCalendar.findAll();
    console.log("SUCCESS!", res.length);
    process.exit(0);
  } catch (err: any) {
    console.error("ERROR QUERYING ACADEMIC CALENDAR:", err.message);
    console.error(err);
    process.exit(1);
  }
};

connectDB(run);
