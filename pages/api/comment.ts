import {NextApiHandler} from "next";
import nextApiEndpoint from "../../utils/nextApiEndpoint";
import {res200, res400, res403, res404} from "next-response-helpers";
import {CommentModel} from "../../models/comment";
import mongoose from "mongoose";
import getLookup from "../../utils/getLookup";

const handler: NextApiHandler = nextApiEndpoint({
    async getFunction(req, res) {
        if (!req.query.nodeId) return res400(res);

        const comments = await CommentModel.aggregate([
            {$match: {nodeId: mongoose.Types.ObjectId(req.query.nodeId.toString())}},
            getLookup("comments", "parentId", "_id", "subComments"),
            getLookup("users", "_id", "userId", "user"),
            {$unwind: "$user"},
        ]);

        return res200(res, comments);
    },
    async postFunction(req, res, session, thisUser) {
        if (!thisUser) return res403(res);
        if (!req.body.body || !req.body.nodeId) return res400(res);

        let commentObj = {
            body: req.body.body,
            nodeId: req.body.nodeId,
            userId: thisUser._id,
        };

        if (req.body.parentId) commentObj["parentId"] = req.body.parentId;

        await CommentModel.create(commentObj);

        return res200(res);
    },
    async deleteFunction(req, res, session, thisUser) {
        if (!thisUser) return res403(res);
        if (!req.body.id) return res400(res);

        const thisComment = await CommentModel.findById(req.body.id);

        if (!thisComment) return res404(res, "No comment for given ID found");
        if (!(thisComment.userId.toString() === thisUser._id)) return res403(res);

        await CommentModel.deleteOne({_id: req.body.id});

        return res200(res);
    },
    allowUnAuthed: true,
});