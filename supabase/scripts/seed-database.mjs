import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadLocalEnv() {
  const envPath = resolve(fileURLToPath(new URL("../..", import.meta.url)), ".env.local");
  try {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] in process.env) continue;
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  } catch {
    // silent
  }
}

loadLocalEnv();

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seedDatabase() {
  console.log("🌱 Seeding Kinetix HRMS Database...\n");

  try {
    // Get or create organization
    console.log("Step 1: Creating organization...");
    let existingOrg = null;
    try {
      const { data } = await admin
        .from("organizations")
        .select("id")
        .eq("slug", "kinetix-demo")
        .single();
      existingOrg = data;
    } catch {
      // org doesn't exist yet
    }

    let orgId = existingOrg?.id;

    if (!orgId) {
      const { data: newOrg, error: orgError } = await admin
        .from("organizations")
        .insert({
          name: "Kinetix Demo Organization",
          slug: "kinetix-demo",
          timezone: "Asia/Kolkata",
          currency: "INR",
        })
        .select("id")
        .single();

      if (orgError) throw orgError;
      orgId = newOrg.id;
      console.log("  ✅ Organization created");
    } else {
      console.log("  ✅ Organization already exists");
    }

    // Get existing profiles/users
    console.log("\nStep 2: Linking existing profiles to organization...");
    const { data: profiles } = await admin.from("profiles").select("id, email").limit(10);

    if (profiles && profiles.length > 0) {
      for (const profile of profiles) {
        await admin
          .from("profiles")
          .update({ organization_id: orgId })
          .eq("id", profile.id)
          .catch(() => {});
      }
      console.log(`  ✅ Updated ${profiles.length} profiles with organization`);
    }

    // Create departments
    console.log("\nStep 3: Creating departments...");
    const departments = [
      { name: "Engineering", code: "ENG" },
      { name: "Human Resources", code: "HR" },
      { name: "Finance", code: "FIN" },
      { name: "Operations", code: "OPS" },
      { name: "Sales", code: "SAL" },
    ];

    const deptMap = {};
    for (const dept of departments) {
      const { data: existing } = await admin
        .from("departments")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", dept.name)
        .single()
        .catch(() => ({ data: null }));

      if (existing?.id) {
        deptMap[dept.name] = existing.id;
      } else {
        const { data: created, error } = await admin
          .from("departments")
          .insert({
            organization_id: orgId,
            name: dept.name,
            code: dept.code,
          })
          .select("id")
          .single();
        if (error) throw error;
        deptMap[dept.name] = created.id;
      }
    }
    console.log(`  ✅ ${Object.keys(deptMap).length} departments ready`);

    // Create designations
    console.log("\nStep 4: Creating designations...");
    const designations = [
      { name: "CEO", dept: "Operations", level: "L5" },
      { name: "Engineering Manager", dept: "Engineering", level: "L4" },
      { name: "Senior Engineer", dept: "Engineering", level: "L3" },
      { name: "Software Engineer", dept: "Engineering", level: "L2" },
      { name: "HR Manager", dept: "Human Resources", level: "L3" },
      { name: "Finance Manager", dept: "Finance", level: "L3" },
      { name: "Sales Manager", dept: "Sales", level: "L3" },
      { name: "Employee", dept: "Operations", level: "L1" },
    ];

    const desigMap = {};
    for (const desig of designations) {
      const { data: existing } = await admin
        .from("designations")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", desig.name)
        .single()
        .catch(() => ({ data: null }));

      if (existing?.id) {
        desigMap[desig.name] = existing.id;
      } else {
        const { data: created, error } = await admin
          .from("designations")
          .insert({
            organization_id: orgId,
            department_id: deptMap[desig.dept],
            name: desig.name,
            level: desig.level,
          })
          .select("id")
          .single();
        if (error) throw error;
        desigMap[desig.name] = created.id;
      }
    }
    console.log(`  ✅ ${Object.keys(desigMap).length} designations ready`);

    // Create shifts
    console.log("\nStep 5: Creating shifts...");
    const shifts = [
      { name: "General Shift", start: "09:30", end: "18:30", breaks: 60, grace: 15 },
      { name: "Early Shift", start: "06:00", end: "14:00", breaks: 45, grace: 10 },
      { name: "Night Shift", start: "22:00", end: "06:00", breaks: 60, grace: 15, isNight: true },
    ];

    const shiftMap = {};
    for (const shift of shifts) {
      const { data: existing } = await admin
        .from("shifts")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", shift.name)
        .single()
        .catch(() => ({ data: null }));

      if (existing?.id) {
        shiftMap[shift.name] = existing.id;
      } else {
        const { data: created, error } = await admin
          .from("shifts")
          .insert({
            organization_id: orgId,
            name: shift.name,
            start_time: shift.start,
            end_time: shift.end,
            break_minutes: shift.breaks,
            grace_minutes: shift.grace,
            is_night_shift: shift.isNight || false,
            week_offs: ["Saturday", "Sunday"],
          })
          .select("id")
          .single();
        if (error) throw error;
        shiftMap[shift.name] = created.id;
      }
    }
    console.log(`  ✅ ${Object.keys(shiftMap).length} shifts ready`);

    // Create employees (link to existing profiles where possible)
    console.log("\nStep 6: Creating employees...");
    const employeeData = [
      {
        email: "admin@test.com",
        first: "Aarav",
        last: "Sharma",
        code: "KIN-0001",
        dept: "Engineering",
        desig: "Engineering Manager",
        role: "admin",
      },
      {
        email: "hr@test.com",
        first: "Meera",
        last: "Iyer",
        code: "KIN-0002",
        dept: "Human Resources",
        desig: "HR Manager",
        role: "hr",
      },
      {
        email: "manager@test.com",
        first: "Rohan",
        last: "Patel",
        code: "KIN-0003",
        dept: "Operations",
        desig: "Engineering Manager",
        role: "manager",
      },
      {
        email: "employee@test.com",
        first: "Nisha",
        last: "Kapoor",
        code: "KIN-0004",
        dept: "Engineering",
        desig: "Software Engineer",
        role: "employee",
      },
      {
        email: "sandeep@yahoo.com",
        first: "Sandeep",
        last: "Patel",
        code: "KIN-0005",
        dept: "Engineering",
        desig: "Software Engineer",
        role: "employee",
      },
    ];

    const empMap = {};
    for (const emp of employeeData) {
      const { data: existing } = await admin
        .from("employees")
        .select("id, user_id")
        .eq("organization_id", orgId)
        .eq("email", emp.email)
        .single()
        .catch(() => ({ data: null }));

      if (existing?.id) {
        empMap[emp.email] = existing.id;
      } else {
        // Find matching profile
        const { data: profile } = await admin
          .from("profiles")
          .select("id")
          .eq("email", emp.email)
          .single()
          .catch(() => ({ data: null }));

        const { data: created, error } = await admin
          .from("employees")
          .insert({
            organization_id: orgId,
            user_id: profile?.id || null,
            employee_code: emp.code,
            first_name: emp.first,
            last_name: emp.last,
            email: emp.email,
            department_id: deptMap[emp.dept],
            designation_id: desigMap[emp.desig],
            shift_id: shiftMap["General Shift"],
            role: emp.role,
            status: "active",
            employment_type: "full-time",
            joined_on: "2023-01-15",
            gender: "Not Specified",
            blood_group: "O+",
            marital_status: "Single",
          })
          .select("id")
          .single();

        if (error) {
          console.error(`Failed to create employee ${emp.email}:`, error);
        } else {
          empMap[emp.email] = created.id;
        }
      }
    }
    console.log(`  ✅ ${Object.keys(empMap).length} employees ready`);

    // Create leave types
    console.log("\nStep 7: Creating leave types...");
    const leaveTypes = [
      { name: "Casual Leave", days: 12 },
      { name: "Sick Leave", days: 6 },
      { name: "Earned Leave", days: 20 },
    ];

    const leaveTypeMap = {};
    for (const lt of leaveTypes) {
      const { data: existing } = await admin
        .from("leave_types")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", lt.name)
        .single()
        .catch(() => ({ data: null }));

      if (existing?.id) {
        leaveTypeMap[lt.name] = existing.id;
      } else {
        const { data: created, error } = await admin
          .from("leave_types")
          .insert({
            organization_id: orgId,
            name: lt.name,
            annual_days: lt.days,
            is_paid: true,
          })
          .select("id")
          .single();
        if (error) throw error;
        leaveTypeMap[lt.name] = created.id;
      }
    }
    console.log(`  ✅ ${Object.keys(leaveTypeMap).length} leave types ready`);

    // Create leave balances for all employees
    console.log("\nStep 8: Creating leave balances...");
    const currentYear = new Date().getFullYear();
    for (const empEmail of Object.keys(empMap)) {
      for (const ltName of Object.keys(leaveTypeMap)) {
        const { data: existing } = await admin
          .from("leave_balances")
          .select("id")
          .eq("employee_id", empMap[empEmail])
          .eq("leave_type_id", leaveTypeMap[ltName])
          .eq("year", currentYear)
          .single()
          .catch(() => ({ data: null }));

        if (!existing?.id) {
          const daysMap = {
            "Casual Leave": 12,
            "Sick Leave": 6,
            "Earned Leave": 20,
          };
          await admin.from("leave_balances").insert({
            organization_id: orgId,
            employee_id: empMap[empEmail],
            leave_type_id: leaveTypeMap[ltName],
            year: currentYear,
            allocated: daysMap[ltName] || 10,
            used: 0,
          });
        }
      }
    }
    console.log("  ✅ Leave balances created");

    // Create attendance records
    console.log("\nStep 9: Creating attendance records...");
    const today = new Date();
    const last30Days = [];
    for (let i = 0; i < 30; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      last30Days.push(date.toISOString().split("T")[0]);
    }

    let attendanceCount = 0;
    for (const empEmail of Object.keys(empMap)) {
      for (const dateStr of last30Days) {
        const { data: existing } = await admin
          .from("attendance")
          .select("id")
          .eq("employee_id", empMap[empEmail])
          .eq("attendance_date", dateStr)
          .single()
          .catch(() => ({ data: null }));

        if (!existing?.id) {
          const dayOfWeek = new Date(dateStr).getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const status = isWeekend ? "week-off" : Math.random() > 0.1 ? "present" : "absent";

          await admin.from("attendance").insert({
            organization_id: orgId,
            employee_id: empMap[empEmail],
            attendance_date: dateStr,
            status,
            check_in: status === "present" ? new Date(`${dateStr}T09:30:00`).toISOString() : null,
            check_out: status === "present" ? new Date(`${dateStr}T18:30:00`).toISOString() : null,
            worked_hours: status === "present" ? 8.5 : 0,
            shift_id: shiftMap["General Shift"],
            source: "web",
          });
          attendanceCount++;
        }
      }
    }
    console.log(`  ✅ ${attendanceCount} attendance records created`);

    // Create salary structures
    console.log("\nStep 10: Creating salary structures...");
    const salaryMap = {
      "admin@test.com": { basic: 250000, hra: 75000, allow: 50000, ded: 30000 },
      "hr@test.com": { basic: 180000, hra: 54000, allow: 30000, ded: 20000 },
      "manager@test.com": { basic: 200000, hra: 60000, allow: 40000, ded: 25000 },
      "employee@test.com": { basic: 120000, hra: 36000, allow: 20000, ded: 15000 },
      "sandeep@yahoo.com": { basic: 120000, hra: 36000, allow: 20000, ded: 15000 },
    };

    for (const [empEmail, sal] of Object.entries(salaryMap)) {
      const { data: existing } = await admin
        .from("salary_structures")
        .select("id")
        .eq("employee_id", empMap[empEmail])
        .single()
        .catch(() => ({ data: null }));

      if (!existing?.id) {
        const ctc = sal.basic + sal.hra + sal.allow;
        await admin.from("salary_structures").insert({
          organization_id: orgId,
          employee_id: empMap[empEmail],
          effective_from: "2024-01-01",
          basic: sal.basic,
          hra: sal.hra,
          allowances: sal.allow,
          deductions: sal.ded,
          ctc_annual: ctc * 12,
        });
      }
    }
    console.log("  ✅ Salary structures created");

    // Create payroll run
    console.log("\nStep 11: Creating payroll data...");
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    const { data: existingRun } = await admin
      .from("payroll_runs")
      .select("id")
      .eq("organization_id", orgId)
      .eq("period", currentMonth)
      .single()
      .catch(() => ({ data: null }));

    let payrollRunId = existingRun?.id;
    if (!payrollRunId) {
      const { data: run, error } = await admin
        .from("payroll_runs")
        .insert({
          organization_id: orgId,
          period: currentMonth,
          employee_count: Object.keys(empMap).length,
          gross: 850000,
          deductions: 100000,
          net: 750000,
          status: "paid",
          pay_date: new Date().toISOString().split("T")[0],
        })
        .select("id")
        .single();
      if (error) throw error;
      payrollRunId = run.id;
    }

    // Create payslips
    let payslipCount = 0;
    for (const [empEmail, sal] of Object.entries(salaryMap)) {
      const { data: existing } = await admin
        .from("payslips")
        .select("id")
        .eq("employee_id", empMap[empEmail])
        .eq("period", currentMonth)
        .single()
        .catch(() => ({ data: null }));

      if (!existing?.id) {
        const grossSal = sal.basic + sal.hra + sal.allow;
        const netSal = grossSal - sal.ded;
        await admin.from("payslips").insert({
          organization_id: orgId,
          payroll_run_id: payrollRunId,
          employee_id: empMap[empEmail],
          period: currentMonth,
          basic: sal.basic,
          hra: sal.hra,
          allowances: sal.allow,
          bonus: 0,
          pf: 0,
          tax: sal.ded / 2,
          other_deductions: sal.ded / 2,
          net: netSal,
          status: "paid",
        });
        payslipCount++;
      }
    }
    console.log(`  ✅ ${payslipCount} payslips created`);

    // Create assets
    console.log("\nStep 12: Creating assets...");
    const assets = [
      { name: "MacBook Pro 16", category: "Laptop", emp: "admin@test.com" },
      { name: "Dell XPS 15", category: "Laptop", emp: "manager@test.com" },
      { name: "iPhone 14 Pro", category: "Mobile", emp: "employee@test.com" },
      { name: "iPad Pro", category: "Tablet", emp: "sandeep@yahoo.com" },
    ];

    let assetCount = 0;
    for (const asset of assets) {
      const { data: existing } = await admin
        .from("assets")
        .select("id")
        .eq("organization_id", orgId)
        .eq("name", asset.name)
        .single()
        .catch(() => ({ data: null }));

      if (!existing?.id) {
        await admin.from("assets").insert({
          organization_id: orgId,
          tag: `ASSET-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
          name: asset.name,
          category: asset.category,
          status: "assigned",
          condition: "good",
          assigned_to: empMap[asset.emp],
          assigned_on: new Date().toISOString().split("T")[0],
          purchase_date: "2024-01-01",
          value: Math.random() * 100000 + 50000,
          warranty_till: "2027-01-01",
        });
        assetCount++;
      }
    }
    console.log(`  ✅ ${assetCount} assets created`);

    // Create goals
    console.log("\nStep 13: Creating goals...");
    let goalCount = 0;
    for (const empEmail of Object.keys(empMap).slice(0, 3)) {
      const { data: existing } = await admin
        .from("goals")
        .select("id")
        .eq("employee_id", empMap[empEmail])
        .limit(2)
        .catch(() => ({ data: [] }));

      if (!existing || existing.length < 2) {
        const goals = [
          { title: "Complete Q3 Project", category: "Business", progress: 75 },
          { title: "Improve Code Quality", category: "Learning", progress: 60 },
        ];

        for (const goal of goals) {
          await admin.from("goals").insert({
            organization_id: orgId,
            employee_id: empMap[empEmail],
            title: goal.title,
            category: goal.category,
            progress: goal.progress,
            weight: 25,
            status: goal.progress === 100 ? "completed" : "on-track",
            due_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          });
          goalCount++;
        }
      }
    }
    console.log(`  ✅ ${goalCount} goals created`);

    // Create announcements
    console.log("\nStep 14: Creating announcements...");
    const announcements = [
      { title: "Welcome to Kinetix", body: "Excited to have you on board!" },
      { title: "New Leave Policy", body: "Updated leave policy effective immediately" },
      { title: "Team Outing", body: "Join us for the annual team outing on 25th Aug" },
    ];

    let announceCount = 0;
    for (const announce of announcements) {
      const { data: existing } = await admin
        .from("announcements")
        .select("id")
        .eq("organization_id", orgId)
        .eq("title", announce.title)
        .single()
        .catch(() => ({ data: null }));

      if (!existing?.id) {
        const { data: adminProfile } = await admin
          .from("profiles")
          .select("id")
          .eq("email", "admin@test.com")
          .single()
          .catch(() => ({ data: null }));

        await admin.from("announcements").insert({
          organization_id: orgId,
          title: announce.title,
          body: announce.body,
          audience: "All",
          author_id: adminProfile?.id || null,
          published_on: new Date().toISOString(),
          pinned: announceCount === 0,
        });
        announceCount++;
      }
    }
    console.log(`  ✅ ${announceCount} announcements created`);

    // Create notifications
    console.log("\nStep 15: Creating notifications...");
    let notifyCount = 0;
    for (const empEmail of Object.keys(empMap)) {
      const { data: existingNotif } = await admin
        .from("notifications")
        .select("id")
        .eq("organization_id", orgId)
        .limit(1)
        .catch(() => ({ data: [] }));

      if (!existingNotif || existingNotif.length === 0) {
        const { data: profile } = await admin
          .from("profiles")
          .select("id")
          .eq("email", empEmail)
          .single()
          .catch(() => ({ data: null }));

        if (profile?.id) {
          const types = ["leave", "payroll", "attendance", "system"];
          for (const type of types) {
            await admin.from("notifications").insert({
              organization_id: orgId,
              user_id: profile.id,
              title: `New ${type} notification`,
              description: `You have a pending ${type} action`,
              type,
              read: Math.random() > 0.5,
            });
            notifyCount++;
          }
        }
      }
    }
    console.log(`  ✅ ${notifyCount} notifications created`);

    // Create organization settings
    console.log("\nStep 16: Creating organization settings...");
    const { data: settings } = await admin
      .from("organization_settings")
      .select("organization_id")
      .eq("organization_id", orgId)
      .single()
      .catch(() => ({ data: null }));

    if (!settings?.organization_id) {
      await admin.from("organization_settings").insert({
        organization_id: orgId,
        settings: {
          theme: "light",
          notificationsEnabled: true,
          workingHours: { start: "09:30", end: "18:30" },
        },
      });
    }
    console.log("  ✅ Organization settings configured");

    // Create user preferences
    console.log("\nStep 17: Creating user preferences...");
    for (const empEmail of Object.keys(empMap)) {
      const { data: profile } = await admin
        .from("profiles")
        .select("id")
        .eq("email", empEmail)
        .single()
        .catch(() => ({ data: null }));

      if (profile?.id) {
        const { data: existing } = await admin
          .from("user_preferences")
          .select("user_id")
          .eq("user_id", profile.id)
          .single()
          .catch(() => ({ data: null }));

        if (!existing?.user_id) {
          await admin.from("user_preferences").insert({
            user_id: profile.id,
            theme: Math.random() > 0.5 ? "dark" : "light",
            preferences: {
              emailNotifications: true,
              pushNotifications: true,
            },
          });
        }
      }
    }
    console.log("  ✅ User preferences created");

    console.log("\n✨ Database seeding complete!\n");
    console.log("📊 Summary:");
    console.log(`  - Organization: ${orgId}`);
    console.log(`  - Employees: ${Object.keys(empMap).length}`);
    console.log(`  - Departments: ${Object.keys(deptMap).length}`);
    console.log(`  - Designations: ${Object.keys(desigMap).length}`);
    console.log(`  - Shifts: ${Object.keys(shiftMap).length}`);
    console.log(`  - Leave Types: ${Object.keys(leaveTypeMap).length}`);
    console.log("\n🚀 Your HRMS is ready with demo data!");
  } catch (error) {
    console.error("❌ Seeding failed:", error.message);
    process.exit(1);
  }
}

seedDatabase();
