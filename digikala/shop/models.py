from django.db import models
from django.utils import timezone


# Create your models here.
class Category_model(models.Model):
    name=models.CharField(max_length=100, verbose_name='نام دسته‌بندی')
    slug=models.SlugField(max_length=200, verbose_name='آدرس دسته‌بندی')

    class Meta:
        verbose_name='دسته‌بندی'
        verbose_name_plural='دسته‌بندی‌ها'

    def __str__(self):
        return self.name



class Customer_model(models.Model):
    first_name=models.CharField(max_length=100, verbose_name='نام')
    last_name=models.CharField(max_length=100, verbose_name='نام خانوادگی')
    phone=models.CharField(max_length=20, verbose_name='شماره همراه')
    emial=models.EmailField(max_length=100, verbose_name='آدرس ایمیل')
    password=models.CharField(max_length=50, verbose_name='رمز عبور')
    credit=models.DecimalField(default=0, decimal_places=0, blank=True, max_digits=12, verbose_name='اعتبار')

    class Meta:
        verbose_name='مشتری'
        verbose_name_plural='مشتری‌ها'

    def __str__(self):
        return f'{self.first_name} {self.last_name}'



class Product_model(models.Model):
    name=models.CharField(max_length=100, verbose_name='نام کالا')
    slug=models.SlugField(max_length=200, verbose_name='آدرس کالا')
    description=models.TextField(max_length=2000000, verbose_name='جزییات')
    price=models.DecimalField(default=0, decimal_places=0, blank=True, max_digits=12, verbose_name='قیمت محصول')
    category=models.ForeignKey(Category_model, on_delete=models.CASCADE, verbose_name='دسته‌بندی')
    picture=models.ImageField(upload_to='product/', verbose_name='تصویر محصول')


    class Meta:
        verbose_name='کالا'
        verbose_name_plural='کالاها'

    def __str__(self):
        return self.name


class Order_model(models.Model):
    STATUS_CHOICES=(('u', 'در دست آماده‌سازی'), ('r', 'آماده تحویل'))
    customer=models.ForeignKey(Customer_model, on_delete=models.CASCADE, null=False, blank=False, verbose_name='مشتری')
    product=models.ForeignKey(Product_model, on_delete=models.CASCADE, null=False, blank=False, verbose_name='کالا')
    date=models.DateTimeField(default=timezone.now, verbose_name='تاریخ سفارش')
    slug=models.SlugField(max_length=200, verbose_name='آدرس سفارش‌')
    status=models.CharField(max_length=1, choices=STATUS_CHOICES, default='u', verbose_name="وضعیت سفارش")
    quantity=models.IntegerField(default=1, verbose_name='تعداد')


    class Meta:
        verbose_name='سفارش'
        verbose_name_plural='سفارشات'

    def __str__(self):
        return self.product
