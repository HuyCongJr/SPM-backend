import db from '../../db/models';
import {createCostPurpose, updateCostPurpose, removeCostPurpose} from "./cost-purpose.service";
import {badRequest, FIELD_ERROR} from '../../config/error';
import {createCostAsset, mergeAssets, removeCostAssets, updateCostAssets} from '../asset/asset.service';
import User from '../../db/models/user/user';

const {Op} = db.Sequelize;

export async function costs(query, order, offset, limit, user) {
  let where = {};
  if (query) {
    if (query.search && query.search.length) {
      where = {
        name: {
          [Op.like]: `%${query.search}%`
        }
      }
    }
    if (query.partnerCompanyId) {
      where.partnerCompanyId = query.partnerCompanyId;
    }
    if (query.partnerPersonId) {
      where.partnerPersonId = query.partnerPersonId;
    }
    if (query.startDate && query.startDate.length
      && query.endDate && query.endDate.length) {
      const dateObjEndDate = new Date(query.endDate);
      dateObjEndDate.setHours(dateObjEndDate.getHours() + 24);
      where.processedDate = {
        [Op.lt]: dateObjEndDate,
        [Op.gte]: new Date(query.startDate)
      };
    } else if (query.endDate && query.endDate.length) {
      const dateObjEndDate = new Date(query.endDate);
      dateObjEndDate.setHours(dateObjEndDate.getHours() + 24);
      where.processedDate = {
        [Op.lt]: dateObjEndDate
      };
    } else if (query.startDate && query.startDate.length) {
      where.processedDate = {
        [Op.gte]: new Date(query.startDate)
      };
    }
    if (query.type && query.type.length) {
      where.type = query.type
    }
  }
  where.companyId = user.companyId;
  return db.Cost.findAndCountAll({
    order,
    where,
    include: [
      {
        model: User, as: 'createdBy',
        attributes: ['id', 'displayName', 'email']
      },
      {model: db.Person, as: 'partnerPerson', attributes: ['id', 'firstName', 'lastName', 'name']},
      {model: db.Company, as: 'partnerCompany', attributes: ['id', 'name']}
    ],
    offset,
    limit
  });
}

export async function createCost(user, createForm) {
  const transaction = await db.sequelize.transaction();

  try {
    const cost = await db.Cost.create({
      name: createForm.name,
      remark: createForm.remark,
      companyId: user.companyId,
      type: createForm.type,
      partnerCompanyId: createForm.partnerCompanyId,
      partnerPersonId: createForm.partnerPersonId,
      processedDate: new Date(),
      amount: createForm.amount,
      createdById: user.id,
      createdDate: new Date()
    }, {transaction});

    if (createForm.assets && createForm.assets.length) {
      await createCostAsset(cost.id, user.companyId, createForm.assets, transaction);
    }

    if (createForm.purposeId && createForm.purposeId.length > 0 && createForm.relativeId && createForm.relativeId.length > 0) {
      await createCostPurpose(cost.id, createForm.purposeId, createForm.relativeId, transaction);
    }
    await transaction.commit();
    return cost;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function getCost(cId, user) {
  const cost = await db.Cost.findOne({
    where: {
      [Op.and]: [
        {id: cId},
        {companyId: user.companyId}
      ]
    },
    include: [
      {model: db.Person, as: 'partnerPerson', attributes: ['id', 'firstName', 'lastName', 'name']},
      {model: db.Company, as: 'partnerCompany', attributes: ['id', 'name']},
      {
        model: db.Asset,
        as: 'assets',
        attributes: ['id', 'name', 'type', 'ext', 'size', 'fileId', 'source'],
        through: {attributes: []}
      },
      {model: db.CostPurpose, as: 'costPurpose', attributes: ['purposeId', 'relativeId']}
    ]
  });
  if (!cost) {
    throw badRequest('cost', FIELD_ERROR.INVALID, 'cost not found');
  }
  return cost;
}

export async function updateCost(cId, user, updateForm) {

  const existedCost = await db.Cost.findOne({
    where: {
      [Op.and]: [
        {id: cId},
        {companyId: user.companyId}
      ]
    },
    include: [{model: db.Asset, as: 'assets'}]
  });
  if (!existedCost) {
    throw badRequest('cost', FIELD_ERROR.INVALID, 'cost not found');
  }
  const transaction = await db.sequelize.transaction();
  try {
    await existedCost.update({
      name: updateForm.name,
      remark: updateForm.remark,
      type: updateForm.type,
      companyId: user.companyId,
      partnerCompanyId: updateForm.partnerCompanyId,
      partnerPersonId: updateForm.partnerPersonId,
      processedDate: updateForm.processedDate,
      amount: updateForm.amount,
      lastModifiedDate: new Date(),
      lastModifiedById: user.id
    }, transaction);

    if (updateForm.purposeId && updateForm.purposeId.length > 0 && updateForm.relativeId && updateForm.relativeId.length > 0) {
      await updateCostPurpose(existedCost.id, updateForm.purposeId, updateForm.relativeId, transaction);
    }

    const listMerge = await mergeAssets(existedCost.assets, updateForm.assets, user.companyId);
    if ((listMerge && listMerge.length) || (existedCost.assets && existedCost.assets.length)) {
      await updateCostAssets(existedCost.assets, listMerge, cId, transaction)
    }
    await transaction.commit();
    return existedCost;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

}

export async function removeCost(cId, user) {
  const checkCost = await db.Cost.findOne({
    where: {
      [Op.and]: [
        {id: cId},
        {companyId: user.companyId}
      ]
    },
    include: [{model: db.Asset, as: 'assets'}]
  });
  if (!checkCost) {
    throw badRequest('cost', FIELD_ERROR.INVALID, 'cost not found');
  }
  const transaction = await db.sequelize.transaction();
  try {
    if (checkCost.assets && checkCost.assets.length) {
      await removeCostAssets(checkCost, transaction);
    }
    await removeCostPurpose(checkCost.id, transaction);
    const cost = db.Cost.destroy({
      where: {id: checkCost.id}
    }, {transaction});
    await transaction.commit();
    return cost;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}