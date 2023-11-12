from django.db import models

# Create your models here.
class category_model(models.Model):
    name=models.CharField(max_length=100, verbose_name='نام دسته‌بندی')
    slug=models.SlugField(max_length=200, verbose_name='آدرس دسته‌بندی')

    class Meta:
        verbose_name='دسته‌بندی'
        verbose_name_plural='دسته‌بندی‌ها'

    def __str__(self):
        return self.name
    


class customer_model(models.Model):
    first_name=models.CharField(max_length=100, verbose_name='نام')
    last_name=models.CharField(max_length=100, verbose_name='نام خانوادگی')
    phone=models.CharField(max_length=20, verbose_name='شماره همراه')
    emial=models.EmailField(max_length=100, verbose_name='آدرس ایمیل')
    password=models.CharField(max_length=50, verbose_name='رمز عبور')
    credit=models.IntegerField(default=0, blank=True, verbose_name='اعتبار')

    class Meta:
        verbose_name='مشتری'
        verbose_name_plural='مشتری‌ها'

    def __str__(self):
        return f'{self.first_name} {self.last_name}'
    


class product_model(models.Model):
    name=models.CharField(max_length=100, verbose_name='نام کالا')
    slug=models.SlugField(max_length=200, verbose_name='آدرس کالا')
    description=models.TextField(max_length=2000000, verbose_name='جزییات')
    price=models.IntegerField(default=50000, blank=True, verbose_name='قیمت محصول')
    category=models.ForeignKey(category_model, on_delete=models.CASCADE, verbose_name='دسته‌بندی')
    picture=models.ImageField(upload_to='product/', verbose_name='تصویر محصول')


    class Meta:
        verbose_name='کالا'
        verbose_name_plural='کالاها'

    def __str__(self):
        return self.name