import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";
import env from "dotenv";

const app = express();
const port = 3000;
const saltRounds = 10;
let isLogged = "Влез";
env.config();
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const FREE_LOADS = 5;

app.set("view engine", "ejs");
app.set('trust proxy', 1);
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      secure: false, // set to true if using https
      maxAge: 3 * 30 * 24 * 60 * 60 * 1000 // 3 months
    }
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());

app.use(passport.initialize());
app.use(passport.session());

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  next();
});

app.get("/", async (req, res) => {
  //if (req.isAuthenticated()) {

    res.render("index.ejs", {
        mapsApiKey: GOOGLE_API_KEY
    });
  //} else {
  //  res.redirect("/login");
//}
});

app.get("/login", (req, res) => {
  let userMismatch = 0;
  let userEmailMismatch = 0;
  const messages = req.session.messages || [];
  res.render("login.ejs", {
    userMismatch,
    userEmailMismatch,
    errorMessage: messages[0] || null, // Show the first message
  });
});

app.get("/register", (req, res) => {
  res.render("register.ejs", { 
    passwordMismatch,
    userExists
  });
  passwordMismatch = 0;
  userExists = 0;
});

app.get("/contact", (req, res) => {
  res.render("contact.ejs");
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

app.post("/login", 
  passport.authenticate("local", {
    successRedirect: "/",
    failureRedirect: "/loginRetry",
    failureMessage: true // Enables passing messages to session
  })
);

app.get("/loginRetry", (req, res) => {
  const messages = req.session.messages || [];
  // Optionally clear messages after using them
  req.session.messages = [];
  res.render("login.ejs", {
    userMismatch: messages.includes('Потребителят не е намерен.') || messages.includes('Въвели сте грешна парола.') ? 1 : 0,
    userEmailMismatch: 0,
    caseError: messages.includes('Потребителското име не е изписано правилно.') ? 1 : 0,
    errorMessage: messages[0] || null // Show the first message
  });
});

app.post("/register", async (req, res) => {
  const username = req.body.username;
  const email = req.body.email;
  const password = req.body.password;
  const password2 = req.body.password2;

  if (password === password2) {
    try {
      const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
        email,
      ]);

      if (checkResult.rows.length > 0) {
        userExists = 1;
        passwordMismatch = 0;
        res.redirect("/register");
      } else {
        bcrypt.hash(password, saltRounds, async (err, hash) => {
          if (err) {
        
          } else {
            const result = await db.query(
              "INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING *",
              [username, email, hash]
            );
            const user = result.rows[0];
            req.login(user, (err) => {
              
              res.redirect("/");
            });
          }
        });
      }
    } catch (err) {
      
    }
  } else {
    passwordMismatch = 1;
    userExists = 0;
    res.redirect("/register");
  }
});

passport.use(
  new Strategy(async function verify(username, password, cb) {
    try {
      // Find user by case-insensitive username or email
      const result = await db.query(
        "SELECT * FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1) LIMIT 1",
        [username]
      );
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;

        // If username was used (not email), check for exact match
        if (
          username.includes('@') === false && // Looks like a username, not email
          user.username !== username          // Case-sensitive mismatch
        ) {
          // Show specific error for wrong case
          return cb(null, false, { message: 'Потребителското име не е изписано правилно.' });
        }

        // Proceed with password check
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            return cb(err);
          } else {
            if (valid) {
              return cb(null, user);
            } else {
              return cb(null, false, { message: 'Въвели сте грешна парола.' });
            }
          }
        });
      } else {
        return cb(null, false, { message: 'Потребителят не е намерен.' });
      }
    } catch (err) {
      console.log(err);
      return cb(err);
    }
  })
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.use ((req, res) => {
  res.render("routeNotFound.ejs");
});

(async () => {
  //await initializeCategories();
  
  app.listen(port, () => {
    console.log('Server started on port 3000');
  });
})();