const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const Users = require('../model/users.model');
const { verifyToken, isAdmin } = require('../middlewares/middleware');
const { validId, stripOperators } = require('../middlewares/guards');

router.param('id', validId);

const withoutPassword = (doc) => {
  const { password, ...safe } = doc.toObject ? doc.toObject() : doc;
  return safe;
};

// Never send password hashes to the browser.
router.get('/', verifyToken, isAdmin, async (req, res) => {
  try {
    const data = await Users.find().select('-password');
    res.status(200).json({ message: 'Record Found', data });
  } catch (err) {
    console.error('GET /users:', err);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});

router.post('/', verifyToken, isAdmin, stripOperators, async (req, res) => {
  try {
    const user = await new Users(req.body).save(); // pre-save hook hashes the password
    res.status(200).json({ message: 'Data inserted successfully!', success: true, data: withoutPassword(user) });
  } catch (err) {
    if (err.code === 11000) return res.status(422).json({ message: 'Already exist!', success: false });
    console.error('POST /users:', err);
    res.status(500).json({ message: 'Internal server error', success: false });
  }
});

// findByIdAndUpdate skips the pre-save hook, so the old code stored new passwords in PLAIN TEXT
// (and the user could never log in again). Hash explicitly here.
router.put('/:id', verifyToken, isAdmin, stripOperators, async (req, res) => {
  try {
    const body = { ...req.body };
    if (typeof body.password === 'string' && body.password.length > 0) {
      body.password = await bcrypt.hash(body.password, 10);
    } else {
      delete body.password; // empty/missing => keep the current password
    }
    const data = await Users.findByIdAndUpdate(req.params.id, body, { new: true }).select('-password');
    if (!data) return res.status(404).json({ message: 'User not found' });
    res.status(200).json({ message: 'Record updated!', data });
  } catch (err) {
    console.error('PUT /users:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.delete('/:id', verifyToken, isAdmin, async (req, res) => {
  try {
    if (req.params.id === String(req.user._id)) {
      return res.status(409).json({ message: 'You cannot delete your own account' });
    }
    const data = await Users.findByIdAndDelete(req.params.id).select('-password');
    res.status(200).json({ message: 'Record deleted!', data });
  } catch (err) {
    console.error('DELETE /users:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;